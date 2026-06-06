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
)

var errDocumentNotFound = errors.New("document not found")

type Document struct {
	ID             bson.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	UserID         bson.ObjectID `bson:"userId" json:"userId"`
	DocumentID     string        `bson:"documentId" json:"documentId"`
	FileID         bson.ObjectID `bson:"fileId,omitempty" json:"fileId,omitempty"`
	FileName       string        `bson:"fileName" json:"fileName"`
	FileSize       int64         `bson:"fileSize" json:"fileSize"`
	ContentType    string        `bson:"contentType" json:"contentType"`
	StorageBackend string        `bson:"storageBackend,omitempty" json:"storageBackend,omitempty"`
	FileURL        string        `bson:"fileUrl,omitempty" json:"fileUrl,omitempty"`
	Source         string        `bson:"source" json:"source"`
	Status         string        `bson:"status" json:"status"`
	CreatedAt      string        `bson:"createdAt" json:"createdAt"`
	UpdatedAt      string        `bson:"updatedAt" json:"updatedAt"`
}

func buildDocumentRecord(req PublishRequest, userID string, fileID bson.ObjectID) (Document, error) {
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return Document{}, err
	}

	documentID := strings.TrimSpace(req.DocumentID)
	now := time.Now().UTC().Format(time.RFC3339)
	return Document{
		ID:             bson.NewObjectID(),
		UserID:         userObjectID,
		DocumentID:     documentID,
		FileID:         fileID,
		FileName:       strings.TrimSpace(req.FileName),
		FileSize:       req.FileSize,
		ContentType:    strings.TrimSpace(req.ContentType),
		StorageBackend: storageBackendGridFS,
		FileURL:        documentFilePath(documentID),
		Source:         strings.TrimSpace(req.Source),
		Status:         documentStatusUploaded,
		CreatedAt:      now,
		UpdatedAt:      now,
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
