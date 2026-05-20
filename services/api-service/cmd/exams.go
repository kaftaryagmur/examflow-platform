package main

import "go.mongodb.org/mongo-driver/v2/bson"

const examsCollection = "exams"

type Exam struct {
	ID               bson.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	UserID           bson.ObjectID `bson:"userId" json:"userId"`
	DocumentID       string        `bson:"documentId" json:"documentId"`
	Title            string        `bson:"title" json:"title"`
	ValidationResult string        `bson:"validationResult" json:"validationResult"`
	Status           string        `bson:"status" json:"status"`
	CreatedAt        string        `bson:"createdAt" json:"createdAt"`
	UpdatedAt        string        `bson:"updatedAt" json:"updatedAt"`
}
