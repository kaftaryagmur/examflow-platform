package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"cloud.google.com/go/pubsub"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

func init() {
	log.SetFlags(0)
}

type healthResponse struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Timestamp string `json:"timestamp"`
}

type validatedEvent struct {
	EventID          string `json:"eventId,omitempty"`
	DocumentID       string `json:"documentId"`
	EventType        string `json:"eventType"`
	ValidationResult string `json:"validationResult"`
	Timestamp        string `json:"timestamp"`
}

type Exam struct {
	ID               bson.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	DocumentID       string        `bson:"documentId" json:"documentId"`
	ValidationResult string        `bson:"validationResult" json:"validationResult"`
	Status           string        `bson:"status" json:"status"`
	CreatedAt        string        `bson:"createdAt" json:"createdAt"`
}

const (
	examStatusDraft      = "draft"
	examStatusProcessing = "processing"
	examStatusValidated  = "validated"
	examStatusPublished  = "published"
	examStatusFailed     = "failed"

	examStatusCreated = examStatusDraft
	examStatusReady   = examStatusValidated
)

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

type examMessage interface {
	ID() string
	Data() []byte
	Ack()
	Nack()
}

type pubsubMessage struct {
	msg *pubsub.Message
}

type mongoDBConfig struct {
	URI      string
	Database string
}

type examStore interface {
	Save(context.Context, Exam) error
}

type noopExamStore struct{}

type mongoExamStore struct {
	collection *mongo.Collection
}

var exams examStore = noopExamStore{}

func (m pubsubMessage) ID() string   { return m.msg.ID }
func (m pubsubMessage) Data() []byte { return m.msg.Data }
func (m pubsubMessage) Ack()         { m.msg.Ack() }
func (m pubsubMessage) Nack()        { m.msg.Nack() }

func main() {
	port := os.Getenv("PORT")
	projectID := os.Getenv("GCP_PROJECT_ID")
	subscriptionID := os.Getenv("PUBSUB_EXAM_SUBSCRIPTION")
	if port == "" {
		port = "8080"
	}

	mongoClient, mongoDatabase, err := connectMongoDB(context.Background())
	if err != nil {
		logKV("warn", "exam-service", "mongodb connection unavailable", "error", err.Error())
	} else if mongoClient != nil {
		defer mongoClient.Disconnect(context.Background())
		exams = mongoExamStore{collection: mongoDatabase.Collection("exams")}
		logKV("info", "exam-service", "mongodb connection ready", "database", mongoDatabase.Name())
	}

	handler := newServer()
	go startConsumer(context.Background(), projectID, subscriptionID)

	logKV("info", "exam-service", "listening", "port", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		logKV("error", "exam-service", "http server stopped", "error", err.Error())
		os.Exit(1)
	}
}

func newServer() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		writeJSON(w, http.StatusOK, healthResponse{
			Status:    "ok",
			Service:   "exam-service",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		})
	})

	return mux
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func startConsumer(ctx context.Context, projectID, subscriptionID string) {
	if projectID == "" || subscriptionID == "" {
		logKV("info", "exam-service", "missing pubsub configuration, consumer disabled")
		return
	}

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		logKV("error", "exam-service", "pubsub client error", "error", err.Error())
		return
	}
	defer client.Close()

	sub := client.Subscription(subscriptionID)
	logKV("info", "exam-service", "listening for messages", "subscription", subscriptionID)

	err = sub.Receive(ctx, func(ctx context.Context, msg *pubsub.Message) {
		handleValidatedMessage(pubsubMessage{msg: msg})
	})
	if err != nil {
		logKV("error", "exam-service", "receive error", "error", err.Error())
	}
}

func handleValidatedMessage(msg examMessage) {
	event, err := parseValidatedEvent(msg.Data())
	if err != nil {
		logKV("error", "exam-service", "message parse failed", "message_id", msg.ID(), "error", err.Error())
		msg.Nack()
		return
	}

	if event.EventType != "exam.validation.completed" {
		logKV("warn", "exam-service", "unexpected event type", "message_id", msg.ID(), "event_type", event.EventType)
		msg.Ack()
		return
	}

	logKV(
		"info", "exam-service", "validation result received",
		"message_id", msg.ID(),
		"document_id", event.DocumentID,
		"event_type", event.EventType,
		"validation_result", event.ValidationResult,
	)

	exam, err := buildExam(event)
	if err != nil {
		logKV("error", "exam-service", "exam lifecycle transition failed", "message_id", msg.ID(), "document_id", event.DocumentID, "error", err.Error())
		msg.Nack()
		return
	}

	if err := exams.Save(context.Background(), exam); err != nil {
		logKV("error", "exam-service", "exam persistence failed", "message_id", msg.ID(), "document_id", exam.DocumentID, "error", err.Error())
		msg.Nack()
		return
	}

	logKV(
		"info", "exam-service", "exam state updated",
		"document_id", exam.DocumentID,
		"validation_result", exam.ValidationResult,
		"state", exam.Status,
		"created_at", exam.CreatedAt,
	)
	msg.Ack()
}

func (noopExamStore) Save(context.Context, Exam) error {
	return nil
}

func (store mongoExamStore) Save(ctx context.Context, exam Exam) error {
	saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if exam.ID.IsZero() {
		exam.ID = bson.NewObjectID()
	}

	_, err := store.collection.InsertOne(saveCtx, exam)
	if err != nil {
		return err
	}
	logKV("info", "exam-service", "exam persisted to mongodb", "document_id", exam.DocumentID, "collection", store.collection.Name())
	return nil
}

func parseValidatedEvent(data []byte) (validatedEvent, error) {
	var event validatedEvent
	if err := json.Unmarshal(data, &event); err != nil {
		return validatedEvent{}, err
	}

	event.EventID = strings.TrimSpace(event.EventID)
	event.DocumentID = strings.TrimSpace(event.DocumentID)
	event.EventType = strings.TrimSpace(event.EventType)
	event.ValidationResult = strings.TrimSpace(event.ValidationResult)
	event.Timestamp = strings.TrimSpace(event.Timestamp)

	if event.EventType == "" {
		return validatedEvent{}, fmt.Errorf("eventType is required")
	}
	if event.ValidationResult == "" {
		return validatedEvent{}, fmt.Errorf("validationResult is required")
	}

	return event, nil
}

func buildExam(event validatedEvent) (Exam, error) {
	status, err := resolveExamLifecycleStatus(event.ValidationResult)
	if err != nil {
		return Exam{}, err
	}

	return Exam{
		ID:               bson.NewObjectID(),
		DocumentID:       event.DocumentID,
		ValidationResult: event.ValidationResult,
		Status:           status,
		CreatedAt:        time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func loadMongoDBConfig() (mongoDBConfig, bool) {
	uri := strings.TrimSpace(os.Getenv("MONGODB_URI"))
	if uri == "" {
		return mongoDBConfig{}, false
	}

	database := strings.TrimSpace(os.Getenv("MONGODB_DATABASE"))
	if database == "" {
		database = "examflow"
	}

	return mongoDBConfig{
		URI:      uri,
		Database: database,
	}, true
}

func connectMongoDB(ctx context.Context) (*mongo.Client, *mongo.Database, error) {
	config, ok := loadMongoDBConfig()
	if !ok {
		return nil, nil, nil
	}

	client, err := mongo.Connect(options.Client().ApplyURI(config.URI))
	if err != nil {
		return nil, nil, err
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, nil, err
	}

	return client, client.Database(config.Database), nil
}

func resolveExamLifecycleStatus(validationResult string) (string, error) {
	status, err := transitionExamStatus(examStatusDraft, examStatusProcessing)
	if err != nil {
		return "", err
	}

	switch strings.ToLower(strings.TrimSpace(validationResult)) {
	case "valid", "passed":
		return transitionExamStatus(status, examStatusValidated)
	case "invalid", "failed":
		return transitionExamStatus(status, examStatusFailed)
	default:
		return "", fmt.Errorf("unsupported validationResult %q", validationResult)
	}
}

func resolveExamStatus(validationResult string) string {
	switch strings.ToLower(strings.TrimSpace(validationResult)) {
	case "valid", "passed":
		return examStatusReady
	case "invalid", "failed":
		return examStatusFailed
	default:
		return examStatusCreated
	}
}

func transitionExamStatus(current, next string) (string, error) {
	allowed, ok := validExamTransitions[current]
	if !ok {
		return "", fmt.Errorf("unknown exam status %q", current)
	}
	if !allowed[next] {
		return "", fmt.Errorf("invalid exam status transition %q -> %q", current, next)
	}
	return next, nil
}

func logKV(level, service, msg string, keyvals ...any) {
	fields := map[string]any{
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"level":     strings.ToUpper(level),
		"service":   service,
		"message":   msg,
	}

	for i := 0; i+1 < len(keyvals); i += 2 {
		key := strings.TrimSpace(fmt.Sprint(keyvals[i]))
		if key == "" {
			continue
		}
		fields[key] = keyvals[i+1]
	}

	encoded, err := json.Marshal(fields)
	if err != nil {
		log.Printf(`{"timestamp":%q,"level":"ERROR","service":%q,"message":"log serialization failed","error":%q}`, time.Now().UTC().Format(time.RFC3339), service, err.Error())
		return
	}

	log.Println(string(encoded))
}
