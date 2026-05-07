package main

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"cloud.google.com/go/pubsub"
)

type fakePublishResult struct {
	messageID string
	err       error
}

func (r fakePublishResult) Get(context.Context) (string, error) {
	return r.messageID, r.err
}

type fakePublisher struct {
	lastPayload []byte
	err         error
}

func (p *fakePublisher) Publish(ctx context.Context, msg *pubsub.Message) publishResult {
	p.lastPayload = msg.Data
	return fakePublishResult{messageID: "msg-123", err: p.err}
}

func TestProcessEventBuildsVisibleResult(t *testing.T) {
	result := processEvent(Event{
		DocumentID: "doc-7",
		UserID:     "user-7",
		FileName:   "lecture-1.pdf",
	})

	if result.DocumentID != "doc-7" {
		t.Fatalf("expected doc-7, got %s", result.DocumentID)
	}
	if result.Status != "processed" {
		t.Fatalf("expected processed status, got %s", result.Status)
	}
	if result.UserID != "user-7" {
		t.Fatalf("expected user-7, got %s", result.UserID)
	}
	if result.SummaryPreview == "" {
		t.Fatal("expected summary preview to be populated")
	}
}

func TestBuildProcessedEventReturnsExpectedFields(t *testing.T) {
	result := ProcessingResult{
		DocumentID:     "doc-123",
		UserID:         "user-123",
		Status:         "processed",
		SummaryPreview: "Processed document doc-123 from file.pdf",
		ProcessedAt:    "2026-05-02T12:30:00Z",
	}

	event := buildProcessedEvent(result)

	if event.EventID == "" {
		t.Fatal("expected eventId to be populated")
	}
	if event.EventType != "document.processed" {
		t.Fatalf("expected document.processed, got %q", event.EventType)
	}
	if event.DocumentID != "doc-123" {
		t.Fatalf("expected doc-123, got %q", event.DocumentID)
	}
	if event.UserID != "user-123" {
		t.Fatalf("expected user-123, got %q", event.UserID)
	}
	if event.Status != "processed" {
		t.Fatalf("expected processed, got %q", event.Status)
	}
	if event.Timestamp == "" {
		t.Fatal("expected timestamp to be populated")
	}
}

func TestShouldProcessEventIgnoresDownstreamEvents(t *testing.T) {
	ignored := []string{
		"document.processed",
		"exam.validation.completed",
		"document.validated",
	}

	for _, eventType := range ignored {
		if shouldProcessEvent(Event{EventType: eventType}) {
			t.Fatalf("expected %s to be ignored", eventType)
		}
	}
}

func TestShouldProcessEventAllowsSourceEvents(t *testing.T) {
	allowed := []string{
		"document.uploaded",
		"document.received",
		"",
	}

	for _, eventType := range allowed {
		if !shouldProcessEvent(Event{EventType: eventType}) {
			t.Fatalf("expected %s to be processed", eventType)
		}
	}
}

func TestPublishProcessedEventPublishesPayload(t *testing.T) {
	pub := &fakePublisher{}

	result := ProcessingResult{
		DocumentID:     "doc-123",
		UserID:         "user-123",
		Status:         "processed",
		SummaryPreview: "Processed document doc-123 from file.pdf",
		ProcessedAt:    "2026-05-02T12:30:00Z",
	}

	if err := publishProcessedEvent(context.Background(), pub, result); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !bytes.Contains(pub.lastPayload, []byte(`"eventType":"document.processed"`)) {
		t.Fatalf("expected eventType in payload, got %s", string(pub.lastPayload))
	}

	if !bytes.Contains(pub.lastPayload, []byte(`"documentId":"doc-123"`)) {
		t.Fatalf("expected documentId in payload, got %s", string(pub.lastPayload))
	}
	if !bytes.Contains(pub.lastPayload, []byte(`"userId":"user-123"`)) {
		t.Fatalf("expected userId in payload, got %s", string(pub.lastPayload))
	}
}

func TestPublishProcessedEventReturnsPublishError(t *testing.T) {
	pub := &fakePublisher{err: errors.New("publish failed")}

	result := ProcessingResult{
		DocumentID:  "doc-123",
		Status:      "processed",
		ProcessedAt: "2026-05-02T12:30:00Z",
	}

	err := publishProcessedEvent(context.Background(), pub, result)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestBuildProcessedEventPreservesEventID(t *testing.T) {
	event := buildProcessedEvent(ProcessingResult{
		EventID:        "evt-trace-69",
		DocumentID:     "doc-69",
		UserID:         "user-69",
		Status:         "processed",
		SummaryPreview: "Processed document doc-69",
		ProcessedAt:    "2026-05-07T19:30:00Z",
	})

	if event.EventID != "evt-trace-69" {
		t.Fatalf("expected eventId to be preserved, got %q", event.EventID)
	}
	if event.DocumentID != "doc-69" {
		t.Fatalf("expected documentId doc-69, got %q", event.DocumentID)
	}
}
