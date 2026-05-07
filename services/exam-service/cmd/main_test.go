package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
		"eventType":        "exam.validation.completed",
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
		"eventType":        "exam.validation.completed",
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
	exam, err := buildExam(validatedEvent{
		DocumentID:       "doc-123",
		ValidationResult: "valid",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if exam.DocumentID != "doc-123" {
		t.Fatalf("expected doc-123, got %q", exam.DocumentID)
	}
	if exam.ValidationResult != "valid" {
		t.Fatalf("expected valid, got %q", exam.ValidationResult)
	}
	if exam.Status != examStatusValidated {
		t.Fatalf("expected %s, got %q", examStatusValidated, exam.Status)
	}
	if exam.CreatedAt == "" {
		t.Fatal("expected createdAt to be populated")
	}
}

func TestResolveExamLifecycleStatusReturnsValidatedForValid(t *testing.T) {
	status, err := resolveExamLifecycleStatus("valid")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if status != examStatusValidated {
		t.Fatalf("expected %s, got %q", examStatusValidated, status)
	}
}

func TestResolveExamLifecycleStatusReturnsFailedForInvalid(t *testing.T) {
	status, err := resolveExamLifecycleStatus("invalid")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if status != examStatusFailed {
		t.Fatalf("expected %s, got %q", examStatusFailed, status)
	}
}

func TestResolveExamLifecycleStatusRejectsUnknownValue(t *testing.T) {
	_, err := resolveExamLifecycleStatus("pending")

	if err == nil {
		t.Fatal("expected validation result error")
	}
}

func TestBuildExamReturnsFailedStatusForInvalidResult(t *testing.T) {
	exam, err := buildExam(validatedEvent{
		DocumentID:       "doc-999",
		ValidationResult: "invalid",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if exam.Status != examStatusFailed {
		t.Fatalf("expected %s, got %q", examStatusFailed, exam.Status)
	}
}

func TestTransitionExamStatusAllowsValidTransitions(t *testing.T) {
	status, err := transitionExamStatus(examStatusDraft, examStatusProcessing)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if status != examStatusProcessing {
		t.Fatalf("expected %s, got %q", examStatusProcessing, status)
	}

	status, err = transitionExamStatus(examStatusProcessing, examStatusValidated)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if status != examStatusValidated {
		t.Fatalf("expected %s, got %q", examStatusValidated, status)
	}

	status, err = transitionExamStatus(examStatusValidated, examStatusPublished)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if status != examStatusPublished {
		t.Fatalf("expected %s, got %q", examStatusPublished, status)
	}
}

func TestTransitionExamStatusRejectsInvalidTransition(t *testing.T) {
	_, err := transitionExamStatus(examStatusDraft, examStatusPublished)

	if err == nil {
		t.Fatal("expected invalid transition error")
	}
}

func TestHandleValidatedMessageAcksValidPayload(t *testing.T) {
	payload, err := json.Marshal(map[string]string{
		"documentId":       "doc-123",
		"eventType":        "exam.validation.completed",
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

func TestResolveExamStatusAcceptsPassed(t *testing.T) {
	got := resolveExamStatus("PASSED")
	if got != examStatusReady {
		t.Fatalf("expected %s, got %s", examStatusReady, got)
	}
}

func TestResolveExamStatusAcceptsFailed(t *testing.T) {
	got := resolveExamStatus("FAILED")
	if got != examStatusFailed {
		t.Fatalf("expected %s, got %s", examStatusFailed, got)
	}
}

func TestDomainCollectionNames(t *testing.T) {
	if usersCollection != "users" {
		t.Fatalf("expected users collection, got %q", usersCollection)
	}
	if documentsCollection != "documents" {
		t.Fatalf("expected documents collection, got %q", documentsCollection)
	}
	if examsCollection != "exams" {
		t.Fatalf("expected exams collection, got %q", examsCollection)
	}
}

func TestUserModelHidesPasswordHashFromJSON(t *testing.T) {
	user := User{
		Email:        "teacher@example.com",
		DisplayName:  "Teacher User",
		PasswordHash: "secret-hash",
		Status:       userStatusActive,
	}

	data, err := json.Marshal(user)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	if string(data) == "" {
		t.Fatal("expected json output")
	}
	if strings.Contains(string(data), "secret-hash") {
		t.Fatal("did not expect password hash in json output")
	}
}

func TestDocumentModelUsesOwnershipAndLifecycleFields(t *testing.T) {
	document := Document{
		FileName: "sample.pdf",
		Source:   "manual",
		Status:   documentStatusUploaded,
	}

	if document.FileName != "sample.pdf" {
		t.Fatalf("expected sample.pdf, got %q", document.FileName)
	}
	if document.Status != documentStatusUploaded {
		t.Fatalf("expected %s, got %q", documentStatusUploaded, document.Status)
	}
}
