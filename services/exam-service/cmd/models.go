package main

import "go.mongodb.org/mongo-driver/v2/bson"

const (
	usersCollection     = "users"
	documentsCollection = "documents"
	examsCollection     = "exams"

	userStatusActive   = "active"
	userStatusDisabled = "disabled"

	documentStatusUploaded   = "uploaded"
	documentStatusProcessing = "processing"
	documentStatusProcessed  = "processed"
	documentStatusFailed     = "failed"

	examStatusDraft      = "draft"
	examStatusProcessing = "processing"
	examStatusValidated  = "validated"
	examStatusPublished  = "published"
	examStatusFailed     = "failed"

	examStatusCreated = examStatusDraft
	examStatusReady   = examStatusValidated
)

type User struct {
	ID           bson.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	Email        string        `bson:"email" json:"email"`
	DisplayName  string        `bson:"displayName" json:"displayName"`
	PasswordHash string        `bson:"passwordHash,omitempty" json:"-"`
	Status       string        `bson:"status" json:"status"`
	CreatedAt    string        `bson:"createdAt" json:"createdAt"`
	UpdatedAt    string        `bson:"updatedAt" json:"updatedAt"`
}

type Document struct {
	ID             bson.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	UserID         bson.ObjectID `bson:"userId" json:"userId"`
	FileName       string        `bson:"fileName" json:"fileName"`
	Source         string        `bson:"source" json:"source"`
	Status         string        `bson:"status" json:"status"`
	ProcessingInfo string        `bson:"processingInfo,omitempty" json:"processingInfo,omitempty"`
	CreatedAt      string        `bson:"createdAt" json:"createdAt"`
	UpdatedAt      string        `bson:"updatedAt" json:"updatedAt"`
}

type Exam struct {
	ID               bson.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	UserID           bson.ObjectID `bson:"userId,omitempty" json:"userId,omitempty"`
	DocumentID       string        `bson:"documentId" json:"documentId"`
	Title            string        `bson:"title,omitempty" json:"title,omitempty"`
	ValidationResult string        `bson:"validationResult" json:"validationResult"`
	Status           string        `bson:"status" json:"status"`
	CreatedAt        string        `bson:"createdAt" json:"createdAt"`
	UpdatedAt        string        `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}

var validExamTransitions = map[string]map[string]bool{
	examStatusDraft: {
		examStatusProcessing: true,
		examStatusFailed:     true,
	},
	examStatusProcessing: {
		examStatusValidated: true,
		examStatusFailed:    true,
	},
	examStatusValidated: {
		examStatusPublished: true,
		examStatusFailed:    true,
	},
	examStatusPublished: {},
	examStatusFailed:    {},
}
