package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeMessage struct {
	id     string
	data   []byte
	acked  bool
	nacked bool
}

func (m *fakeMessage) ID() string   { return m.id }
func (m *fakeMessage) Data() []byte { return m.data }
func (m *fakeMessage) Ack()         { m.acked = true }
func (m *fakeMessage) Nack()        { m.nacked = true }

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

func TestParseValidatedEventReturnsFields(t *testing.T) {
	payload, err := json.Marshal(map[string]string{
		"documentId":       "doc-123",
		"eventType":        "document.validated",
		"validationResult": "valid",
		"timestamp":        "2026-04-26T15:00:00Z",
	})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	event, err := parseValidatedEvent(payload)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if event.DocumentID != "doc-123" {
		t.Fatalf("expected doc-123, got %q", event.DocumentID)
	}
	if event.ValidationResult != "valid" {
		t.Fatalf("expected valid, got %q", event.ValidationResult)
	}
}

func TestParseValidatedEventRequiresValidationResult(t *testing.T) {
	payload, err := json.Marshal(map[string]string{
		"documentId":       "doc-123",
		"eventType":        "document.validated",
		"validationResult": " ",
	})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	_, err = parseValidatedEvent(payload)
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestBuildExamReturnsExpectedFields(t *testing.T) {
	exam := buildExam(validatedEvent{
		DocumentID:       "doc-123",
		ValidationResult: "valid",
	})

	if exam.DocumentID != "doc-123" {
		t.Fatalf("expected doc-123, got %q", exam.DocumentID)
	}
	if exam.ValidationResult != "valid" {
		t.Fatalf("expected valid, got %q", exam.ValidationResult)
	}
	if exam.Status != "created" {
		t.Fatalf("expected created, got %q", exam.Status)
	}
	if exam.CreatedAt == "" {
		t.Fatal("expected createdAt to be populated")
	}
}

func TestHandleValidatedMessageAcksValidPayload(t *testing.T) {
	payload, err := json.Marshal(map[string]string{
		"documentId":       "doc-123",
		"eventType":        "document.validated",
		"validationResult": "valid",
	})
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	msg := &fakeMessage{id: "msg-1", data: payload}
	handleValidatedMessage(msg)

	if !msg.acked {
		t.Fatal("expected message to be acked")
	}
	if msg.nacked {
		t.Fatal("did not expect message to be nacked")
	}
}

func TestHandleValidatedMessageNacksInvalidJSON(t *testing.T) {
	msg := &fakeMessage{id: "msg-2", data: []byte("{invalid")}
	handleValidatedMessage(msg)

	if !msg.nacked {
		t.Fatal("expected message to be nacked")
	}
	if msg.acked {
		t.Fatal("did not expect message to be acked")
	}
}
