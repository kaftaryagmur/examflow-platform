package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/pubsub"
)

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
	Status    string `json:"status"`
	Service   string `json:"service"`
	Mode      string `json:"mode"`
	Timestamp string `json:"timestamp"`
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

	handler := newServer(ctx, pub, mode)

	logKV("info", "api-service", "listening", "port", port, "mode", mode)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func newServer(ctx context.Context, pub publisher, mode string) http.Handler {
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
			Status:    "ready",
			Service:   "api-service",
			Mode:      mode,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}
		if pub == nil {
			status = http.StatusAccepted
			body.Status = "degraded"
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
	fields := map[string]string{
		"level":   level,
		"service": service,
		"msg":     msg,
	}

	for i := 0; i+1 < len(keyvals); i += 2 {
		key := fmt.Sprint(keyvals[i])
		fields[key] = valueToString(keyvals[i+1])
	}

	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%q", key, fields[key]))
	}
	log.Println(strings.Join(parts, " "))
}

func valueToString(v any) string {
	switch value := v.(type) {
	case string:
		return value
	case int:
		return strconv.Itoa(value)
	case int64:
		return strconv.FormatInt(value, 10)
	default:
		return fmt.Sprint(value)
	}
}
