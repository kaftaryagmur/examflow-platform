package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

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
