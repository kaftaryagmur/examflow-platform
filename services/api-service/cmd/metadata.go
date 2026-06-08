package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

const (
	maxRecordTags = 12
	maxTagLength  = 32
)

type RecordMetadataRequest struct {
	Favorite bool     `json:"favorite"`
	Tags     []string `json:"tags"`
}

func decodeRecordMetadataRequest(r *http.Request) (RecordMetadataRequest, error) {
	defer r.Body.Close()

	var req RecordMetadataRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return RecordMetadataRequest{}, errors.New("invalid metadata request")
	}
	req.Tags = normalizeTags(req.Tags)
	return req, nil
}

func normalizeTags(tags []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		clean := strings.ToLower(strings.TrimSpace(tag))
		clean = strings.Trim(clean, "#")
		if clean == "" || seen[clean] {
			continue
		}
		if len(clean) > maxTagLength {
			clean = clean[:maxTagLength]
		}
		seen[clean] = true
		out = append(out, clean)
		if len(out) >= maxRecordTags {
			break
		}
	}
	return out
}

func documentMetadataIDFromPath(path string) (string, bool) {
	const prefix = "/documents/"
	const suffix = "/metadata"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	return recordIDFromPath(path, prefix, suffix)
}

func examMetadataIDFromPath(path string) (string, bool) {
	const prefix = "/exams/"
	const suffix = "/metadata"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	return recordIDFromPath(path, prefix, suffix)
}

func recordIDFromPath(path, prefix, suffix string) (string, bool) {
	value := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	value = strings.Trim(value, "/")
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	id, err := url.PathUnescape(value)
	if err != nil {
		return "", false
	}
	id = strings.TrimSpace(id)
	return id, id != ""
}

func updateDocumentMetadataHandler(documents documentStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		claims, ok := authPrincipalFromContext(r.Context())
		if !ok {
			http.Error(w, "auth context unavailable", http.StatusUnauthorized)
			return
		}
		if documents == nil {
			http.Error(w, "document store unavailable", http.StatusServiceUnavailable)
			return
		}
		documentID, ok := documentMetadataIDFromPath(r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}
		req, err := decodeRecordMetadataRequest(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		document, err := documents.UpdateDocumentMetadata(r.Context(), claims.UserID, documentID, req)
		if errors.Is(err, errDocumentNotFound) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			logKV("error", "api-service", "document metadata update failed", "endpoint", "/documents/{documentId}/metadata", "user_id", claims.UserID, "document_id", documentID, "error", err.Error())
			http.Error(w, "document metadata update failed", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"document": document})
	}
}

func updateExamMetadataHandler(exams examStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		claims, ok := authPrincipalFromContext(r.Context())
		if !ok {
			http.Error(w, "auth context unavailable", http.StatusUnauthorized)
			return
		}
		if exams == nil {
			http.Error(w, "exam store unavailable", http.StatusServiceUnavailable)
			return
		}
		examKey, ok := examMetadataIDFromPath(r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}
		req, err := decodeRecordMetadataRequest(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		exam, err := exams.UpdateExamMetadata(r.Context(), claims.UserID, examKey, req)
		if errors.Is(err, errExamNotFound) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			logKV("error", "api-service", "exam metadata update failed", "endpoint", "/exams/{examKey}/metadata", "user_id", claims.UserID, "exam_key", examKey, "error", err.Error())
			http.Error(w, "exam metadata update failed", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"exam": exam})
	}
}

func (store mongoDocumentStore) UpdateDocumentMetadata(ctx context.Context, userID string, documentID string, metadata RecordMetadataRequest) (Document, error) {
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return Document{}, err
	}

	updateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	now := time.Now().UTC().Format(time.RFC3339)
	filter := bson.M{"userId": userObjectID, "documentId": strings.TrimSpace(documentID)}
	update := bson.M{"$set": bson.M{
		"favorite":  metadata.Favorite,
		"tags":      metadata.Tags,
		"updatedAt": now,
	}}
	if _, err := store.collection.UpdateOne(updateCtx, filter, update); err != nil {
		return Document{}, err
	}

	var document Document
	err = store.collection.FindOne(updateCtx, filter).Decode(&document)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Document{}, errDocumentNotFound
	}
	if err != nil {
		return Document{}, err
	}
	return document, nil
}

func (store mongoExamStore) UpdateExamMetadata(ctx context.Context, userID string, examKey string, metadata RecordMetadataRequest) (Exam, error) {
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return Exam{}, err
	}

	updateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	key := strings.TrimSpace(examKey)
	filter := bson.M{"userId": userObjectID, "$or": []bson.M{{"documentId": key}}}
	if objectID, err := bson.ObjectIDFromHex(key); err == nil {
		filter["$or"] = []bson.M{{"_id": objectID}, {"documentId": key}}
	}

	now := time.Now().UTC().Format(time.RFC3339)
	update := bson.M{"$set": bson.M{
		"favorite":  metadata.Favorite,
		"tags":      metadata.Tags,
		"updatedAt": now,
	}}
	if _, err := store.collection.UpdateOne(updateCtx, filter, update); err != nil {
		return Exam{}, err
	}

	var exam Exam
	err = store.collection.FindOne(updateCtx, filter).Decode(&exam)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Exam{}, errExamNotFound
	}
	if err != nil {
		return Exam{}, err
	}
	return exam, nil
}
