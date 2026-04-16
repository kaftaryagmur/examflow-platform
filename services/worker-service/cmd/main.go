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

func main() {
	projectID := os.Getenv("GCP_PROJECT_ID")
	subscriptionID := os.Getenv("PUBSUB_SUBSCRIPTION")

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
	logKV("info", "worker-service", "listening for messages", "subscription", subscriptionID)

	err = sub.Receive(ctx, func(ctx context.Context, msg *pubsub.Message) {
		logKV("info", "worker-service", "message received", "message_id", msg.ID, "payload", string(msg.Data))

		event, err := parseEvent(msg.Data)
		if err != nil {
			logKV("error", "worker-service", "message parse failed", "message_id", msg.ID, "error", err.Error())
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
