package main

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"cloud.google.com/go/pubsub"
)

type fakePublishResult struct {
	id  string
	err error
}

func (f fakePublishResult) Get(context.Context) (string, error) {
	return f.id, f.err
}

type fakePublisher struct {
	lastPayload []byte
	result      fakePublishResult
}

func (f *fakePublisher) Publish(_ context.Context, msg *pubsub.Message) publishResult {
	f.lastPayload = msg.Data
	return f.result
}

func TestProcessEventBuildsVisibleResult(t *testing.T) {
	result := processEvent(Event{
		DocumentID: "doc-7",
		FileName:   "lecture-1.pdf",
	})

	if result.DocumentID != "doc-7" {
		t.Fatalf("expected doc-7, got %s", result.DocumentID)
	}
	if result.Status != "processed" {
		t.Fatalf("expected processed status, got %s", result.Status)
	}
	if result.SummaryPreview == "" {
		t.Fatal("expected summary preview to be populated")
	}
}

func TestBuildProcessedEventReturnsExpectedFields(t *testing.T) {
	event := buildProcessedEvent(ProcessingResult{
		DocumentID: "doc-7",
		Status:     "processed",
	})

	if event.DocumentID != "doc-7" {
		t.Fatalf("expected doc-7, got %q", event.DocumentID)
	}
	if event.EventType != "document.processed" {
		t.Fatalf("expected document.processed, got %q", event.EventType)
	}
	if event.Timestamp == "" {
		t.Fatal("expected timestamp")
	}
}

func TestPublishProcessedEventPublishesPayload(t *testing.T) {
	pub := &fakePublisher{result: fakePublishResult{id: "msg-123"}}

	err := publishProcessedEvent(context.Background(), pub, ProcessingResult{
		DocumentID: "doc-7",
		Status:     "processed",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !bytes.Contains(pub.lastPayload, []byte(`"documentId":"doc-7"`)) {
		t.Fatalf("expected documentId in payload, got %s", string(pub.lastPayload))
	}
	if !bytes.Contains(pub.lastPayload, []byte(`"eventType":"document.processed"`)) {
		t.Fatalf("expected processed event type in payload, got %s", string(pub.lastPayload))
	}
}

func TestPublishProcessedEventReturnsPublishError(t *testing.T) {
	pub := &fakePublisher{result: fakePublishResult{err: errors.New("publish failed")}}

	err := publishProcessedEvent(context.Background(), pub, ProcessingResult{
		DocumentID: "doc-7",
		Status:     "processed",
	})
	if err == nil {
		t.Fatal("expected publish error")
	}
}
