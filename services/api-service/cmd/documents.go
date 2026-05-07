package main

import (
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

const (
	documentsCollection = "documents"

	documentStatusUploaded = "uploaded"
)

type Document struct {
	ID         bson.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	UserID     bson.ObjectID `bson:"userId" json:"userId"`
	DocumentID string        `bson:"documentId" json:"documentId"`
	FileName   string        `bson:"fileName" json:"fileName"`
	Source     string        `bson:"source" json:"source"`
	Status     string        `bson:"status" json:"status"`
	CreatedAt  string        `bson:"createdAt" json:"createdAt"`
	UpdatedAt  string        `bson:"updatedAt" json:"updatedAt"`
}

func buildDocumentRecord(req PublishRequest, userID string) (Document, error) {
	userObjectID, err := bson.ObjectIDFromHex(strings.TrimSpace(userID))
	if err != nil {
		return Document{}, fmt.Errorf("invalid userId %q", userID)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	return Document{
		ID:         bson.NewObjectID(),
		UserID:     userObjectID,
		DocumentID: strings.TrimSpace(req.DocumentID),
		FileName:   strings.TrimSpace(req.FileName),
		Source:     strings.TrimSpace(req.Source),
		Status:     documentStatusUploaded,
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}
