package main

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

const (
	documentsCollection = "documents"

	documentStatusUploaded = "uploaded"
	storageBackendGridFS   = "gridfs"

	difficultyEasy   = "easy"
	difficultyMedium = "medium"
	difficultyHard   = "hard"
	difficultyMixed  = "mixed"

	defaultQuestionCount = 5
	defaultInfoCardCount = 3
	maxQuestionCount     = 20
	maxInfoCardCount     = 10
	maxFocusLength       = 500
)

var errDocumentNotFound = errors.New("document not found")

type Document struct {
	ID              bson.ObjectID   `bson:"_id,omitempty" json:"id,omitempty"`
	UserID          bson.ObjectID   `bson:"userId" json:"userId"`
	DocumentID      string          `bson:"documentId" json:"documentId"`
	FileID          bson.ObjectID   `bson:"fileId,omitempty" json:"fileId,omitempty"`
	FileName        string          `bson:"fileName" json:"fileName"`
	FileSize        int64           `bson:"fileSize" json:"fileSize"`
	ContentType     string          `bson:"contentType" json:"contentType"`
	StorageBackend  string          `bson:"storageBackend,omitempty" json:"storageBackend,omitempty"`
	FileURL         string          `bson:"fileUrl,omitempty" json:"fileUrl,omitempty"`
	Source          string          `bson:"source" json:"source"`
	Status          string          `bson:"status" json:"status"`
	GenerationPrefs GenerationPrefs `bson:"generationPrefs,omitempty" json:"generationPrefs,omitempty"`
	CreatedAt       string          `bson:"createdAt" json:"createdAt"`
	UpdatedAt       string          `bson:"updatedAt" json:"updatedAt"`
}

// GenerationPrefs are the end-user's requested AI generation parameters,
// captured at upload time and consumed by exam-service.
type GenerationPrefs struct {
	QuestionCount int    `bson:"questionCount,omitempty" json:"questionCount,omitempty"`
	Difficulty    string `bson:"difficulty,omitempty" json:"difficulty,omitempty"`
	InfoCardCount int    `bson:"infoCardCount,omitempty" json:"infoCardCount,omitempty"`
	Focus         string `bson:"focus,omitempty" json:"focus,omitempty"`
}

// normalizeGenerationPrefs clamps user-provided values into safe ranges and
// applies defaults so downstream services always receive sane prefs.
func normalizeGenerationPrefs(p GenerationPrefs) GenerationPrefs {
	out := p
	if out.QuestionCount <= 0 {
		out.QuestionCount = defaultQuestionCount
	}
	if out.QuestionCount > maxQuestionCount {
		out.QuestionCount = maxQuestionCount
	}
	if out.InfoCardCount < 0 {
		out.InfoCardCount = 0
	}
	if out.InfoCardCount == 0 {
		out.InfoCardCount = defaultInfoCardCount
	}
	if out.InfoCardCount > maxInfoCardCount {
		out.InfoCardCount = maxInfoCardCount
	}
	switch strings.ToLower(strings.TrimSpace(out.Difficulty)) {
	case difficultyEasy, difficultyMedium, difficultyHard, difficultyMixed:
		out.Difficulty = strings.ToLower(strings.TrimSpace(out.Difficulty))
	default:
		out.Difficulty = difficultyMixed
	}
	out.Focus = strings.TrimSpace(out.Focus)
	if len(out.Focus) > maxFocusLength {
		out.Focus = out.Focus[:maxFocusLength]
	}
	return out
}

func buildDocumentRecord(req PublishRequest, userID string, fileID bson.ObjectID) (Document, error) {
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return Document{}, err
	}

	documentID := strings.TrimSpace(req.DocumentID)
	now := time.Now().UTC().Format(time.RFC3339)
	return Document{
		ID:              bson.NewObjectID(),
		UserID:          userObjectID,
		DocumentID:      documentID,
		FileID:          fileID,
		FileName:        strings.TrimSpace(req.FileName),
		FileSize:        req.FileSize,
		ContentType:     strings.TrimSpace(req.ContentType),
		StorageBackend:  storageBackendGridFS,
		FileURL:         documentFilePath(documentID),
		Source:          strings.TrimSpace(req.Source),
		Status:          documentStatusUploaded,
		GenerationPrefs: normalizeGenerationPrefs(req.GenerationPrefs),
		CreatedAt:       now,
		UpdatedAt:       now,
	}, nil
}

func documentFilePath(documentID string) string {
	return "/documents/" + url.PathEscape(strings.TrimSpace(documentID)) + "/file"
}

func objectIDFromUserID(userID string) (bson.ObjectID, error) {
	userObjectID, err := bson.ObjectIDFromHex(strings.TrimSpace(userID))
	if err != nil {
		return bson.ObjectID{}, fmt.Errorf("invalid userId %q", userID)
	}
	return userObjectID, nil
}
