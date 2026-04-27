package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

func TestHealthReturnsOK(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	newServer().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected application/json, got %q", got)
	}

	body := rec.Body.String()
	if body == "" {
		t.Fatal("expected response body")
	}
}

func TestHealthRejectsNonGET(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/health", nil)
	rec := httptest.NewRecorder()

	newServer().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestParseProcessedEventReturnsFields(t *testing.T) {
	payload, err := json.Marshal(map[string]string{
		"documentId": "doc-42",
		"eventType":  "document.processed",
		"timestamp":  "2026-04-26T15:00:00Z",
	})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	event, err := parseProcessedEvent(payload)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if event.DocumentID != "doc-42" {
		t.Fatalf("expected doc-42, got %q", event.DocumentID)
	}
	if event.EventType != "document.processed" {
		t.Fatalf("expected document.processed, got %q", event.EventType)
	}
	if event.Timestamp != "2026-04-26T15:00:00Z" {
		t.Fatalf("expected timestamp to be parsed, got %q", event.Timestamp)
	}
}

func TestParseProcessedEventRequiresCoreFields(t *testing.T) {
	payload, err := json.Marshal(map[string]string{
		"documentId": "doc-42",
		"eventType":  " ",
		"timestamp":  "2026-04-26T15:00:00Z",
	})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	_, err = parseProcessedEvent(payload)
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestParseProcessedEventAllowsEmptyDocumentID(t *testing.T) {
	payload, err := json.Marshal(map[string]string{
		"documentId": " ",
		"eventType":  "document.processed",
		"timestamp":  "2026-04-26T15:00:00Z",
	})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	event, err := parseProcessedEvent(payload)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if event.DocumentID != "" {
		t.Fatalf("expected trimmed empty documentId, got %q", event.DocumentID)
	}
}

func TestValidateDocumentReturnsValidWhenDocumentIDExists(t *testing.T) {
	result := validateDocument(processedEvent{DocumentID: "doc-123"})

	if result.Status != "valid" {
		t.Fatalf("expected valid, got %q", result.Status)
	}
	if result.DocumentID != "doc-123" {
		t.Fatalf("expected doc-123, got %q", result.DocumentID)
	}
}

func TestValidateDocumentReturnsInvalidWhenDocumentIDMissing(t *testing.T) {
	result := validateDocument(processedEvent{DocumentID: ""})

	if result.Status != "invalid" {
		t.Fatalf("expected invalid, got %q", result.Status)
	}
}

func TestBuildValidatedEventReturnsExpectedFields(t *testing.T) {
	event := buildValidatedEvent(validationResult{
		DocumentID: "doc-123",
		Status:     "valid",
	})

	if event.DocumentID != "doc-123" {
		t.Fatalf("expected doc-123, got %q", event.DocumentID)
	}
	if event.EventType != "document.validated" {
		t.Fatalf("expected document.validated, got %q", event.EventType)
	}
	if event.ValidationResult != "valid" {
		t.Fatalf("expected valid, got %q", event.ValidationResult)
	}
	if event.Timestamp == "" {
		t.Fatal("expected timestamp to be populated")
	}
}

func TestPublishValidatedEventPublishesPayload(t *testing.T) {
	pub := &fakePublisher{
		result: fakePublishResult{id: "msg-123"},
	}

	err := publishValidatedEvent(context.Background(), pub, validationResult{
		DocumentID: "doc-123",
		Status:     "valid",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !bytes.Contains(pub.lastPayload, []byte(`"documentId":"doc-123"`)) {
		t.Fatalf("expected documentId in payload, got %s", string(pub.lastPayload))
	}
	if !bytes.Contains(pub.lastPayload, []byte(`"eventType":"document.validated"`)) {
		t.Fatalf("expected eventType in payload, got %s", string(pub.lastPayload))
	}
	if !bytes.Contains(pub.lastPayload, []byte(`"validationResult":"valid"`)) {
		t.Fatalf("expected validationResult in payload, got %s", string(pub.lastPayload))
	}
}

func TestPublishValidatedEventReturnsPublishError(t *testing.T) {
	pub := &fakePublisher{
		result: fakePublishResult{err: errors.New("publish failed")},
	}

	err := publishValidatedEvent(context.Background(), pub, validationResult{
		DocumentID: "doc-123",
		Status:     "valid",
	})
	if err == nil {
		t.Fatal("expected publish error")
	}
}
