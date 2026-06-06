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
	DocumentID     string        `bson:"documentId" json:"documentId"`
	FileID         bson.ObjectID `bson:"fileId,omitempty" json:"fileId,omitempty"`
	FileName       string        `bson:"fileName" json:"fileName"`
	ContentType    string        `bson:"contentType,omitempty" json:"contentType,omitempty"`
	Source         string        `bson:"source" json:"source"`
	Status         string        `bson:"status" json:"status"`
	ProcessingInfo string        `bson:"processingInfo,omitempty" json:"processingInfo,omitempty"`
	CreatedAt      string        `bson:"createdAt" json:"createdAt"`
	UpdatedAt      string        `bson:"updatedAt" json:"updatedAt"`
}

type Exam struct {
	ID               bson.ObjectID  `bson:"_id,omitempty" json:"id,omitempty"`
	UserID           bson.ObjectID  `bson:"userId,omitempty" json:"userId,omitempty"`
	DocumentID       string         `bson:"documentId" json:"documentId"`
	Title            string         `bson:"title,omitempty" json:"title,omitempty"`
	ValidationResult string         `bson:"validationResult" json:"validationResult"`
	Status           string         `bson:"status" json:"status"`
	Questions        []ExamQuestion `bson:"questions,omitempty" json:"questions,omitempty"`
	InfoCards        []ExamInfoCard `bson:"infoCards,omitempty" json:"infoCards,omitempty"`
	GenerationModel  string         `bson:"generationModel,omitempty" json:"generationModel,omitempty"`
	CreatedAt        string         `bson:"createdAt" json:"createdAt"`
	UpdatedAt        string         `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}

// ExamQuestion is a single AI-generated multiple choice question. Field names
// match the contract the frontend exam detail viewer already consumes.
type ExamQuestion struct {
	Question      string   `bson:"question" json:"question"`
	Options       []string `bson:"options" json:"options"`
	CorrectAnswer string   `bson:"correctAnswer" json:"correctAnswer"`
	Explanation   string   `bson:"explanation" json:"explanation"`
	Difficulty    string   `bson:"difficulty" json:"difficulty"`
	Topic         string   `bson:"topic" json:"topic"`
}

// ExamInfoCard is a short, AI-generated study card derived from the document.
type ExamInfoCard struct {
	Title     string   `bson:"title" json:"title"`
	Summary   string   `bson:"summary" json:"summary"`
	KeyPoints []string `bson:"keyPoints,omitempty" json:"keyPoints,omitempty"`
}

// GeneratedContent is the structured output the question generator returns.
type GeneratedContent struct {
	Questions []ExamQuestion `json:"questions"`
	InfoCards []ExamInfoCard `json:"infoCards"`
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
