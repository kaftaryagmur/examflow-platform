package main

import "go.mongodb.org/mongo-driver/v2/bson"

const examsCollection = "exams"

type Exam struct {
	ID               bson.ObjectID   `bson:"_id,omitempty" json:"id,omitempty"`
	UserID           bson.ObjectID   `bson:"userId" json:"userId"`
	DocumentID       string          `bson:"documentId" json:"documentId"`
	Title            string          `bson:"title" json:"title"`
	ValidationResult string          `bson:"validationResult" json:"validationResult"`
	Status           string          `bson:"status" json:"status"`
	Questions        []ExamQuestion  `bson:"questions,omitempty" json:"questions,omitempty"`
	InfoCards        []ExamInfoCard  `bson:"infoCards,omitempty" json:"infoCards,omitempty"`
	GenerationModel  string          `bson:"generationModel,omitempty" json:"generationModel,omitempty"`
	GenerationPrefs  GenerationPrefs `bson:"generationPrefs,omitempty" json:"generationPrefs,omitempty"`
	QualityStatus    string          `bson:"qualityStatus,omitempty" json:"qualityStatus,omitempty"`
	QualityIssues    []string        `bson:"qualityIssues,omitempty" json:"qualityIssues,omitempty"`
	CreatedAt        string          `bson:"createdAt" json:"createdAt"`
	UpdatedAt        string          `bson:"updatedAt" json:"updatedAt"`
}

// ExamQuestion mirrors the structured question the exam-service persists; it is
// returned verbatim to the frontend exam detail viewer.
type ExamQuestion struct {
	Question      string   `bson:"question" json:"question"`
	Options       []string `bson:"options" json:"options"`
	CorrectAnswer string   `bson:"correctAnswer" json:"correctAnswer"`
	Explanation   string   `bson:"explanation" json:"explanation"`
	Difficulty    string   `bson:"difficulty" json:"difficulty"`
	Topic         string   `bson:"topic" json:"topic"`
}

// ExamInfoCard mirrors the persisted study card and is returned to the frontend.
type ExamInfoCard struct {
	Title     string   `bson:"title" json:"title"`
	Summary   string   `bson:"summary" json:"summary"`
	KeyPoints []string `bson:"keyPoints,omitempty" json:"keyPoints,omitempty"`
}
