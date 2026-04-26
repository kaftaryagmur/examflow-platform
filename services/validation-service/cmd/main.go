package main

import (
	"context"
	"encoding/json"
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

type healthResponse struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Timestamp string `json:"timestamp"`
}

type processedEvent struct {
	DocumentID string `json:"documentId"`
	EventType  string `json:"eventType"`
	Timestamp  string `json:"timestamp"`
}

type validationResult struct {
	DocumentID string
	Status     string
}

func main() {
	port := os.Getenv("PORT")
	projectID := os.Getenv("GCP_PROJECT_ID")
	subscriptionID := os.Getenv("PUBSUB_VALIDATION_SUBSCRIPTION")

	if port == "" {
		port = "8080"
	}

	handler := newServer()

	go startConsumer(context.Background(), projectID, subscriptionID)

	log.Printf("service=%q msg=%q port=%q", "validation-service", "listening", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
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
			Service:   "validation-service",
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
		logKV("info", "validation-service", "missing pubsub configuration, consumer disabled")
		return
	}

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		logKV("error", "validation-service", "pubsub client error", "error", err.Error())
		return
	}
	defer client.Close()

	sub := client.Subscription(subscriptionID)
	logKV("info", "validation-service", "listening for messages", "subscription", subscriptionID)

	err = sub.Receive(ctx, func(ctx context.Context, msg *pubsub.Message) {
		event, err := parseProcessedEvent(msg.Data)
		if err != nil {
			logKV("error", "validation-service", "message parse failed", "message_id", msg.ID, "error", err.Error())
			msg.Ack()
			return
		}

		if event.EventType != "document.processed" {
			logKV("warn", "validation-service", "unexpected event type", "message_id", msg.ID, "event_type", event.EventType)
			msg.Ack()
			return
		}

		logKV(
			"info", "validation-service", "document.processed received",
			"message_id", msg.ID,
			"document_id", event.DocumentID,
			"event_type", event.EventType,
			"timestamp", event.Timestamp,
		)

		result := validateDocument(event)
		log.Printf("validation_result=%s document_id=%s", result.Status, result.DocumentID)
		msg.Ack()
	})
	if err != nil {
		logKV("error", "validation-service", "receive error", "error", err.Error())
	}
}

func parseProcessedEvent(data []byte) (processedEvent, error) {
	var event processedEvent
	if err := json.Unmarshal(data, &event); err != nil {
		return processedEvent{}, err
	}

	event.DocumentID = strings.TrimSpace(event.DocumentID)
	event.EventType = strings.TrimSpace(event.EventType)
	event.Timestamp = strings.TrimSpace(event.Timestamp)

	if event.EventType == "" {
		return processedEvent{}, fmt.Errorf("eventType is required")
	}
	if event.Timestamp == "" {
		return processedEvent{}, fmt.Errorf("timestamp is required")
	}

	return event, nil
}

func validateDocument(event processedEvent) validationResult {
	status := "invalid"
	if strings.TrimSpace(event.DocumentID) != "" {
		status = "valid"
	}

	return validationResult{
		DocumentID: event.DocumentID,
		Status:     status,
	}
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
