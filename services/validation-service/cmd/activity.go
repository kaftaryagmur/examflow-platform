package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
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

func connectActivityMongo(ctx context.Context) (*mongo.Client, *mongo.Collection, error) {
	uri := strings.TrimSpace(os.Getenv("MONGODB_URI"))
	if uri == "" {
		return nil, nil, nil
	}
	database := strings.TrimSpace(os.Getenv("MONGODB_DATABASE"))
	if database == "" {
		database = "examflow"
	}

	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, nil, err
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, nil, err
	}

	return client, client.Database(database).Collection(activityEventsCollection), nil
}

func newActivityFromProcessedEvent(event processedEvent, status, eventType, message, errorText string) (activityEvent, error) {
	return newActivityRecord(event.UserID, event.DocumentID, event.EventID, status, eventType, message, errorText)
}

func newActivityFromValidationResult(result validationResult, status, eventType, message, errorText string) (activityEvent, error) {
	return newActivityRecord(result.UserID, result.DocumentID, result.EventID, status, eventType, message, errorText)
}

func newActivityRecord(userID, documentID, eventID, status, eventType, message, errorText string) (activityEvent, error) {
	userObjectID, err := bson.ObjectIDFromHex(strings.TrimSpace(userID))
	if err != nil {
		return activityEvent{}, fmt.Errorf("invalid userId %q", userID)
	}
	return activityEvent{
		ID:         bson.NewObjectID(),
		UserID:     userObjectID,
		DocumentID: strings.TrimSpace(documentID),
		EventID:    strings.TrimSpace(eventID),
		EventType:  strings.TrimSpace(eventType),
		Status:     strings.TrimSpace(status),
		Service:    "validation-service",
		Message:    strings.TrimSpace(message),
		Error:      strings.TrimSpace(errorText),
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func recordProcessedActivity(ctx context.Context, event processedEvent, status, eventType, message, errorText string) {
	if activity == nil {
		return
	}
	record, err := newActivityFromProcessedEvent(event, status, eventType, message, errorText)
	if err != nil {
		logKV("warn", "validation-service", "activity event build failed", "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())
		return
	}
	if err := activity.RecordActivity(ctx, record); err != nil {
		logKV("warn", "validation-service", "activity event persistence failed", "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())
	}
}

func recordValidationActivity(ctx context.Context, result validationResult, status, eventType, message, errorText string) {
	if activity == nil {
		return
	}
	record, err := newActivityFromValidationResult(result, status, eventType, message, errorText)
	if err != nil {
		logKV("warn", "validation-service", "activity event build failed", "event_id", result.EventID, "document_id", result.DocumentID, "error", err.Error())
		return
	}
	if err := activity.RecordActivity(ctx, record); err != nil {
		logKV("warn", "validation-service", "activity event persistence failed", "event_id", result.EventID, "document_id", result.DocumentID, "error", err.Error())
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
