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
)

func init() {
	log.SetFlags(0)
}

type healthResponse struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Timestamp string `json:"timestamp"`
}

type processedEvent struct {
	DocumentID string `json:"documentId"`
	UserID     string `json:"userId"`
	EventType  string `json:"eventType"`
	Timestamp  string `json:"timestamp"`
}

type validationResult struct {
	DocumentID string
	UserID     string
	Status     string
}

type validatedEvent struct {
	EventID          string `json:"eventId,omitempty"`
	DocumentID       string `json:"documentId"`
	UserID           string `json:"userId"`
	EventType        string `json:"eventType"`
	ValidationResult string `json:"validationResult"`
	Timestamp        string `json:"timestamp"`
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
	port := os.Getenv("PORT")
	projectID := os.Getenv("GCP_PROJECT_ID")
	subscriptionID := os.Getenv("PUBSUB_VALIDATION_SUBSCRIPTION")
	validatedTopicID := os.Getenv("PUBSUB_VALIDATED_TOPIC")

	if port == "" {
		port = "8080"
	}

	handler := newServer()

	go startConsumer(context.Background(), projectID, subscriptionID, validatedTopicID)

	logKV("info", "validation-service", "listening", "port", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		logKV("error", "validation-service", "http server stopped", "error", err.Error())
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

func startConsumer(ctx context.Context, projectID, subscriptionID, validatedTopicID string) {
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
	var pub publisher
	if validatedTopicID == "" {
		logKV("warn", "validation-service", "validated topic not configured, publish disabled")
	} else {
		pub = topicPublisher{topic: client.Topic(validatedTopicID)}
	}

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
		logKV("info", "validation-service", "validation completed", "validation_result", result.Status, "document_id", result.DocumentID)

		if err := publishValidatedEvent(ctx, pub, result); err != nil {
			logKV("error", "validation-service", "validated event publish failed", "document_id", result.DocumentID, "error", err.Error())
			msg.Nack()
			return
		}
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
	event.UserID = strings.TrimSpace(event.UserID)
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
		UserID:     event.UserID,
		Status:     status,
	}
}

func publishValidatedEvent(ctx context.Context, pub publisher, result validationResult) error {
	if pub == nil {
		logKV("warn", "validation-service", "validated event publisher unavailable", "document_id", result.DocumentID)
		return nil
	}

	event := buildValidatedEvent(result)
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	messageID, err := pub.Publish(ctx, &pubsub.Message{Data: payload}).Get(ctx)
	if err != nil {
		return err
	}

	logKV(
		"info", "validation-service", "exam.validation.completed published",
		"service", "validation-service",
		"event_type", event.EventType,
		"document_id", event.DocumentID,
		"validation_result", event.ValidationResult,
		"message_id", messageID,
		"event_id", event.EventID,
	)
	return nil
}

func buildValidatedEvent(result validationResult) validatedEvent {
	eventTimestamp := time.Now().UTC().Format(time.RFC3339)

	return validatedEvent{
		EventID:          fmt.Sprintf("validation-%s-%d", result.DocumentID, time.Now().UTC().UnixNano()),
		DocumentID:       result.DocumentID,
		UserID:           result.UserID,
		EventType:        "exam.validation.completed",
		ValidationResult: result.Status,
		Timestamp:        eventTimestamp,
	}
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
