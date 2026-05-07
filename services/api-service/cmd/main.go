package main

import (
	"context"
	"encoding/json"
	"errors"
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

type Event struct {
	EventType  string `json:"eventType"`
	DocumentID string `json:"documentId"`
	FileName   string `json:"fileName,omitempty"`
	Source     string `json:"source,omitempty"`
	Timestamp  string `json:"timestamp"`
}

type PublishRequest struct {
	DocumentID string `json:"documentId"`
	FileName   string `json:"fileName"`
	Source     string `json:"source"`
}

type PublishResponse struct {
	Status    string `json:"status"`
	MessageID string `json:"messageId,omitempty"`
	Mode      string `json:"mode"`
	Event     Event  `json:"event"`
}

type StatusResponse struct {
	Status         string `json:"status"`
	Service        string `json:"service"`
	Mode           string `json:"mode"`
	DatabaseStatus string `json:"databaseStatus,omitempty"`
	DatabaseName   string `json:"databaseName,omitempty"`
	Timestamp      string `json:"timestamp"`
}

type publisher interface {
	Publish(context.Context, *pubsub.Message) publishResult
}

type publishResult interface {
	Get(context.Context) (string, error)
}

type topicPublisher struct {
	topic *pubsub.Topic
}

type mongoDBConfig struct {
	URI      string
	Database string
}

type databaseClient interface {
	Name() string
	Ping(context.Context) error
	VerifyReadWrite(context.Context, string) error
	Close(context.Context) error
}

type mongoDatabaseClient struct {
	client   *mongo.Client
	database *mongo.Database
	name     string
}

func (t topicPublisher) Publish(ctx context.Context, msg *pubsub.Message) publishResult {
	return t.topic.Publish(ctx, msg)
}

func main() {
	projectID := os.Getenv("GCP_PROJECT_ID")
	topicID := os.Getenv("PUBSUB_TOPIC")
	port := os.Getenv("PORT")

	if port == "" {
		port = "8080"
	}

	ctx := context.Background()
	mode := "mock"

	var pub publisher
	if projectID != "" && topicID != "" {
		client, err := pubsub.NewClient(ctx, projectID)
		if err != nil {
			logKV("warn", "api-service", "pubsub client could not be created", "error", err.Error())
		} else {
			pub = topicPublisher{topic: client.Topic(topicID)}
			mode = "pubsub"
		}
	} else {
		logKV("info", "api-service", "missing pubsub configuration, running in mock mode")
	}

	db, err := connectMongoDB(ctx)
	if err != nil {
		logKV("warn", "api-service", "mongodb connection unavailable", "error", err.Error())
	} else {
		defer db.Close(ctx)
		if err := db.VerifyReadWrite(ctx, "api-service"); err != nil {
			logKV("warn", "api-service", "mongodb startup read/write check failed", "database", db.Name(), "error", err.Error())
		} else {
			logKV("info", "api-service", "mongodb connection ready", "database", db.Name())
		}
	}

	handler := newServer(ctx, pub, mode, db)

	logKV("info", "api-service", "listening", "port", port, "mode", mode)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		logKV("error", "api-service", "http server stopped", "error", err.Error())
		os.Exit(1)
	}
}

func newServer(ctx context.Context, pub publisher, mode string, db databaseClient) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, StatusResponse{
			Status:    "ok",
			Service:   "api-service",
			Mode:      mode,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		status := http.StatusOK
		body := StatusResponse{
			Status:         "ready",
			Service:        "api-service",
			Mode:           mode,
			DatabaseStatus: "not_configured",
			Timestamp:      time.Now().UTC().Format(time.RFC3339),
		}
		if pub == nil {
			status = http.StatusAccepted
			body.Status = "degraded"
		}

		if db != nil {
			body.DatabaseName = db.Name()
			if err := db.Ping(r.Context()); err != nil {
				status = http.StatusServiceUnavailable
				body.Status = "degraded"
				body.DatabaseStatus = "unreachable"
				logKV("warn", "api-service", "mongodb readiness check failed", "database", db.Name(), "error", err.Error())
			} else {
				body.DatabaseStatus = "ready"
			}
		}
		writeJSON(w, status, body)
	})

	mux.HandleFunc("/publish", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		req, err := decodePublishRequest(r)
		if err != nil {
			logKV("warn", "api-service", "invalid request", "endpoint", "/publish", "error", err.Error())
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		event := buildEvent(req)
		logKV(
			"info", "api-service", "request received",
			"endpoint", "/publish",
			"document_id", event.DocumentID,
			"file_name", event.FileName,
			"source", event.Source,
			"mode", mode,
		)

		payload, err := json.Marshal(event)
		if err != nil {
			logKV("error", "api-service", "event marshal failed", "endpoint", "/publish", "error", err.Error())
			http.Error(w, "could not create event payload", http.StatusInternalServerError)
			return
		}

		if pub == nil {
			logKV("info", "api-service", "mock event published", "endpoint", "/publish", "payload", string(payload))
			writeJSON(w, http.StatusOK, PublishResponse{
				Status: "accepted",
				Mode:   mode,
				Event:  event,
			})
			return
		}

		logKV("info", "api-service", "publishing event", "endpoint", "/publish", "document_id", event.DocumentID, "event_type", event.EventType)
		messageID, err := pub.Publish(ctx, &pubsub.Message{Data: payload}).Get(ctx)
		if err != nil {
			logKV("error", "api-service", "publish failed", "endpoint", "/publish", "document_id", event.DocumentID, "error", err.Error())
			http.Error(w, "publish failed", http.StatusInternalServerError)
			return
		}

		logKV("info", "api-service", "event published", "endpoint", "/publish", "document_id", event.DocumentID, "message_id", messageID)
		writeJSON(w, http.StatusOK, PublishResponse{
			Status:    "accepted",
			MessageID: messageID,
			Mode:      mode,
			Event:     event,
		})
	})

	return withCORS(withRequestLogging("api-service", mux))
}

func decodePublishRequest(r *http.Request) (PublishRequest, error) {
	defer r.Body.Close()

	var req PublishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return PublishRequest{}, errors.New("invalid json body")
	}

	if strings.TrimSpace(req.DocumentID) == "" {
		return PublishRequest{}, errors.New("documentId is required")
	}

	if strings.TrimSpace(req.Source) == "" {
		req.Source = "manual"
	}

	return req, nil
}

func buildEvent(req PublishRequest) Event {
	return Event{
		EventType:  "document.uploaded",
		DocumentID: strings.TrimSpace(req.DocumentID),
		FileName:   strings.TrimSpace(req.FileName),
		Source:     strings.TrimSpace(req.Source),
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
	}
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

func connectMongoDB(ctx context.Context) (databaseClient, error) {
	config, ok := loadMongoDBConfig()
	if !ok {
		return nil, nil
	}

	client, err := mongo.Connect(options.Client().ApplyURI(config.URI))
	if err != nil {
		return nil, err
	}

	db := &mongoDatabaseClient{
		client:   client,
		database: client.Database(config.Database),
		name:     config.Database,
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.Ping(pingCtx); err != nil {
		_ = db.Close(context.Background())
		return nil, err
	}

	return db, nil
}

func (db *mongoDatabaseClient) Name() string {
	return db.name
}

func (db *mongoDatabaseClient) Ping(ctx context.Context) error {
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return db.client.Ping(pingCtx, readpref.Primary())
}

func (db *mongoDatabaseClient) VerifyReadWrite(ctx context.Context, service string) error {
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	id := bson.NewObjectID()
	collection := db.database.Collection("connection_checks")
	document := bson.M{
		"_id":       id,
		"service":   service,
		"checkedAt": time.Now().UTC(),
	}

	if _, err := collection.InsertOne(checkCtx, document); err != nil {
		return err
	}

	var stored struct {
		ID bson.ObjectID `bson:"_id"`
	}
	if err := collection.FindOne(checkCtx, bson.M{"_id": id}).Decode(&stored); err != nil {
		return err
	}
	if stored.ID != id {
		return fmt.Errorf("mongodb read/write check returned unexpected id")
	}
	return nil
}

func (db *mongoDatabaseClient) Close(ctx context.Context) error {
	closeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return db.client.Disconnect(closeCtx)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func withRequestLogging(service string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(recorder, r)

		logKV(
			"info", service, "request completed",
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"duration_ms", time.Since(start).Milliseconds(),
			"remote_addr", r.RemoteAddr,
		)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
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
