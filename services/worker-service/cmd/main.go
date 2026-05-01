package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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

type ProcessingResult struct {
	DocumentID     string `json:"documentId"`
	Status         string `json:"status"`
	SummaryPreview string `json:"summaryPreview"`
	ProcessedAt    string `json:"processedAt"`
}

type ProcessedEvent struct {
	EventID        string `json:"eventId,omitempty"`
	EventType      string `json:"eventType"`
	DocumentID     string `json:"documentId"`
	Status         string `json:"status"`
	SummaryPreview string `json:"summaryPreview,omitempty"`
	ProcessedAt    string `json:"processedAt"`
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

func (t topicPublisher) Publish(ctx context.Context, msg *pubsub.Message) publishResult {
	return t.topic.Publish(ctx, msg)
}

func main() {
	projectID := os.Getenv("GCP_PROJECT_ID")
	subscriptionID := os.Getenv("PUBSUB_SUBSCRIPTION")
	topicID := os.Getenv("PUBSUB_TOPIC")

	ctx := context.Background()

	if projectID == "" || subscriptionID == "" {
		logKV("info", "worker-service", "missing pubsub configuration, running in mock mode")
		for {
			logKV("info", "worker-service", "mock worker waiting for messages")
			time.Sleep(10 * time.Second)
		}
	}

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		logKV("error", "worker-service", "pubsub client error", "error", err.Error())
		log.Fatal("worker-service failed to start")
	}

	sub := client.Subscription(subscriptionID)

	var pub publisher
	if topicID == "" {
		logKV("warn", "worker-service", "processed topic not configured, publish disabled")
	} else {
		pub = topicPublisher{topic: client.Topic(topicID)}
	}

	logKV("info", "worker-service", "listening for messages", "subscription", subscriptionID)

	err = sub.Receive(ctx, func(ctx context.Context, msg *pubsub.Message) {
		logKV("info", "worker-service", "message received", "message_id", msg.ID, "payload", string(msg.Data))

		event, err := parseEvent(msg.Data)
		if err != nil {
			logKV("error", "worker-service", "message parse failed", "message_id", msg.ID, "error", err.Error())
			msg.Ack()
			return
		}

		if !shouldProcessEvent(event) {
			logKV(
				"info", "worker-service", "event ignored",
				"message_id", msg.ID,
				"event_type", event.EventType,
				"document_id", event.DocumentID,
			)
			msg.Ack()
			return
		}

		start := time.Now()
		logKV("info", "worker-service", "processing started", "document_id", event.DocumentID, "event_type", event.EventType, "source", event.Source)
		result := processEvent(event)
		resultPayload, _ := json.Marshal(result)

		logKV(
			"info", "worker-service", "processing completed",
			"document_id", event.DocumentID,
			"duration_ms", time.Since(start).Milliseconds(),
			"result", string(resultPayload),
		)

		if err := publishProcessedEvent(ctx, pub, result); err != nil {
			logKV(
				"error", "worker-service", "processed event publish failed",
				"document_id", result.DocumentID,
				"error", err.Error(),
			)
			msg.Nack()
			return
		}

		msg.Ack()
	})
	if err != nil {
		logKV("error", "worker-service", "receive error", "error", err.Error())
		log.Fatal("worker-service stopped")
	}
}

func parseEvent(data []byte) (Event, error) {
	var event Event
	err := json.Unmarshal(data, &event)
	if err != nil {
		return Event{}, err
	}
	return event, nil
}

func processEvent(event Event) ProcessingResult {
	fileName := strings.TrimSpace(event.FileName)
	if fileName == "" {
		fileName = "unknown-file"
	}

	return ProcessingResult{
		DocumentID:     event.DocumentID,
		Status:         "processed",
		SummaryPreview: "Processed document " + event.DocumentID + " from " + fileName,
		ProcessedAt:    time.Now().UTC().Format(time.RFC3339),
	}
}

func shouldProcessEvent(event Event) bool {
	eventType := strings.ToLower(strings.TrimSpace(event.EventType))
	switch eventType {
	case "document.processed", "exam.validation.completed", "document.validated":
		return false
	default:
		return true
	}
}

func buildProcessedEvent(result ProcessingResult) ProcessedEvent {
	now := time.Now().UTC()

	return ProcessedEvent{
		EventID:        fmt.Sprintf("processing-%s-%d", result.DocumentID, now.UnixNano()),
		EventType:      "document.processed",
		DocumentID:     result.DocumentID,
		Status:         result.Status,
		SummaryPreview: result.SummaryPreview,
		ProcessedAt:    result.ProcessedAt,
		Timestamp:      now.Format(time.RFC3339),
	}
}

func publishProcessedEvent(ctx context.Context, pub publisher, result ProcessingResult) error {
	if pub == nil {
		logKV(
			"warn", "worker-service", "processed event publisher unavailable",
			"document_id", result.DocumentID,
		)
		return nil
	}

	event := buildProcessedEvent(result)

	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	messageID, err := pub.Publish(ctx, &pubsub.Message{Data: payload}).Get(ctx)
	if err != nil {
		return err
	}

	logKV(
		"info", "worker-service", "document.processed published",
		"event_id", event.EventID,
		"event_type", event.EventType,
		"document_id", event.DocumentID,
		"status", event.Status,
		"message_id", messageID,
	)

	return nil
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
