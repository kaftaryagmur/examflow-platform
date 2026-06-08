package main

import (
	"context"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	activityEventsCollection = "activity_events"

	activityStatusReceived   = "received"
	activityStatusPublished  = "published"
	activityStatusProcessing = "processing"
	activityStatusProcessed  = "processed"
	activityStatusValidated  = "validated"
	activityStatusFailed     = "failed"
)

type ActivityEvent struct {
	ID         bson.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	UserID     bson.ObjectID `bson:"userId" json:"userId"`
	DocumentID string        `bson:"documentId" json:"documentId"`
	EventID    string        `bson:"eventId,omitempty" json:"eventId,omitempty"`
	EventType  string        `bson:"eventType" json:"eventType"`
	Status     string        `bson:"status" json:"status"`
	Service    string        `bson:"service" json:"service"`
	Message    string        `bson:"message" json:"message"`
	Error      string        `bson:"error,omitempty" json:"error,omitempty"`
	CreatedAt  string        `bson:"createdAt" json:"createdAt"`
}

type activityStore interface {
	CreateActivity(context.Context, ActivityEvent) error
	ListActivities(context.Context, string, string) ([]ActivityEvent, error)
	ListAllActivities(context.Context, string) ([]ActivityEvent, error)
}

type mongoActivityStore struct {
	collection *mongo.Collection
}

var activities activityStore

func newActivityEvent(userID, documentID, eventID, eventType, status, service, message, errorText string) (ActivityEvent, error) {
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return ActivityEvent{}, err
	}

	return ActivityEvent{
		ID:         bson.NewObjectID(),
		UserID:     userObjectID,
		DocumentID: strings.TrimSpace(documentID),
		EventID:    strings.TrimSpace(eventID),
		EventType:  strings.TrimSpace(eventType),
		Status:     strings.TrimSpace(status),
		Service:    strings.TrimSpace(service),
		Message:    strings.TrimSpace(message),
		Error:      strings.TrimSpace(errorText),
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func recordPublishActivity(ctx context.Context, event Event, status, eventType, message, errorText string) {
	if activities == nil {
		return
	}

	activity, err := newActivityEvent(event.UserID, event.DocumentID, event.EventID, eventType, status, "api-service", message, errorText)
	if err != nil {
		logKV("warn", "api-service", "activity event build failed", "document_id", event.DocumentID, "event_id", event.EventID, "error", err.Error())
		return
	}
	if err := activities.CreateActivity(ctx, activity); err != nil {
		logKV("warn", "api-service", "activity event persistence failed", "document_id", event.DocumentID, "event_id", event.EventID, "error", err.Error())
	}
}

func (store mongoActivityStore) CreateActivity(ctx context.Context, event ActivityEvent) error {
	saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if event.ID.IsZero() {
		event.ID = bson.NewObjectID()
	}
	if event.CreatedAt == "" {
		event.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	_, err := store.collection.InsertOne(saveCtx, event)
	return err
}

func (store mongoActivityStore) ListActivities(ctx context.Context, userID, documentID string) ([]ActivityEvent, error) {
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return nil, err
	}

	filter := bson.M{"userId": userObjectID}
	if trimmedDocumentID := strings.TrimSpace(documentID); trimmedDocumentID != "" {
		filter["documentId"] = trimmedDocumentID
	}

	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cursor, err := store.collection.Find(
		findCtx,
		filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(150),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(findCtx)

	var events []ActivityEvent
	if err := cursor.All(findCtx, &events); err != nil {
		return nil, err
	}
	return events, nil
}

func (store mongoActivityStore) ListAllActivities(ctx context.Context, documentID string) ([]ActivityEvent, error) {
	filter := bson.M{}
	if trimmedDocumentID := strings.TrimSpace(documentID); trimmedDocumentID != "" {
		filter["documentId"] = trimmedDocumentID
	}

	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cursor, err := store.collection.Find(
		findCtx,
		filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(300),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(findCtx)

	var events []ActivityEvent
	if err := cursor.All(findCtx, &events); err != nil {
		return nil, err
	}
	return events, nil
}

func ensureActivityIndexes(ctx context.Context, store activityStore) error {
	mongoStore, ok := store.(mongoActivityStore)
	if !ok {
		return nil
	}

	indexCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, err := mongoStore.collection.Indexes().CreateMany(indexCtx, []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "userId", Value: 1}, {Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("activity_user_createdAt"),
		},
		{
			Keys:    bson.D{{Key: "userId", Value: 1}, {Key: "documentId", Value: 1}, {Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("activity_user_document_createdAt"),
		},
		{
			Keys:    bson.D{{Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("activity_createdAt"),
		},
	})
	return err
}
