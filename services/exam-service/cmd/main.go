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

type validatedEvent struct {
	DocumentID       string `json:"documentId"`
	EventType        string `json:"eventType"`
	ValidationResult string `json:"validationResult"`
	Timestamp        string `json:"timestamp"`
}

type Exam struct {
	DocumentID       string `json:"documentId"`
	ValidationResult string `json:"validationResult"`
	Status           string `json:"status"`
	CreatedAt        string `json:"createdAt"`
}

const (
	examStatusDraft      = "draft"
	examStatusProcessing = "processing"
	examStatusValidated  = "validated"
	examStatusPublished  = "published"
	examStatusFailed     = "failed"
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

	handler := newServer()
	go startConsumer(context.Background(), projectID, subscriptionID)

	log.Printf("service=%q msg=%q port=%q", "exam-service", "listening", port)
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

	if event.EventType != "document.validated" {
		logKV("warn", "exam-service", "unexpected event type", "message_id", msg.ID(), "event_type", event.EventType)
		msg.Ack()
		return
	}

	exam, err := buildExam(event)
	if err != nil {
		logKV("error", "exam-service", "exam lifecycle transition failed", "message_id", msg.ID(), "document_id", event.DocumentID, "error", err.Error())
		msg.Nack()
		return
	}

	log.Printf(
		"exam_created document_id=%s validation_result=%s status=%s created_at=%s",
		exam.DocumentID,
		exam.ValidationResult,
		exam.Status,
		exam.CreatedAt,
	)
	msg.Ack()
}

func parseValidatedEvent(data []byte) (validatedEvent, error) {
	var event validatedEvent
	if err := json.Unmarshal(data, &event); err != nil {
		return validatedEvent{}, err
	}

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
		DocumentID:       event.DocumentID,
		ValidationResult: event.ValidationResult,
		Status:           status,
		CreatedAt:        time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func resolveExamLifecycleStatus(validationResult string) (string, error) {
	status, err := transitionExamStatus(examStatusDraft, examStatusProcessing)
	if err != nil {
		return "", err
	}

	switch strings.TrimSpace(validationResult) {
	case "valid":
		return transitionExamStatus(status, examStatusValidated)
	case "invalid":
		return transitionExamStatus(status, examStatusFailed)
	default:
		return "", fmt.Errorf("unsupported validationResult %q", validationResult)
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
