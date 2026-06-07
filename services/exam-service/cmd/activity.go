package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

const (
	activityEventsCollection = "activity_events"

	activityStatusProcessing = "processing"
	activityStatusValidated  = "validated"
	activityStatusFailed     = "failed"
)

type activityEvent struct {
	ID         bson.ObjectID `bson:"_id,omitempty"`
	UserID     bson.ObjectID `bson:"userId"`
	DocumentID string        `bson:"documentId"`
	EventID    string        `bson:"eventId,omitempty"`
	EventType  string        `bson:"eventType"`
	Status     string        `bson:"status"`
	Service    string        `bson:"service"`
	Message    string        `bson:"message"`
	Error      string        `bson:"error,omitempty"`
	CreatedAt  string        `bson:"createdAt"`
}

type activityRecorder interface {
	RecordActivity(context.Context, activityEvent) error
}

type noopActivityRecorder struct{}

type mongoActivityRecorder struct {
	collection *mongo.Collection
}

var activity activityRecorder = noopActivityRecorder{}

func newActivityFromValidatedEvent(event validatedEvent, status, eventType, message, errorText string) (activityEvent, error) {
	userObjectID, err := bson.ObjectIDFromHex(strings.TrimSpace(event.UserID))
	if err != nil {
		return activityEvent{}, fmt.Errorf("invalid userId %q", event.UserID)
	}
	return activityEvent{
		ID:         bson.NewObjectID(),
		UserID:     userObjectID,
		DocumentID: strings.TrimSpace(event.DocumentID),
		EventID:    strings.TrimSpace(event.EventID),
		EventType:  strings.TrimSpace(eventType),
		Status:     strings.TrimSpace(status),
		Service:    "exam-service",
		Message:    strings.TrimSpace(message),
		Error:      strings.TrimSpace(errorText),
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func recordExamActivity(ctx context.Context, event validatedEvent, status, eventType, message, errorText string) {
	if activity == nil {
		return
	}
	record, err := newActivityFromValidatedEvent(event, status, eventType, message, errorText)
	if err != nil {
		logKV("warn", "exam-service", "activity event build failed", "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())
		return
	}
	if err := activity.RecordActivity(ctx, record); err != nil {
		logKV("warn", "exam-service", "activity event persistence failed", "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())
	}
}

func (noopActivityRecorder) RecordActivity(context.Context, activityEvent) error {
	return nil
}

func (rec mongoActivityRecorder) RecordActivity(ctx context.Context, event activityEvent) error {
	saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if event.ID.IsZero() {
		event.ID = bson.NewObjectID()
	}
	if event.CreatedAt == "" {
		event.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	_, err := rec.collection.InsertOne(saveCtx, event)
	return err
}
