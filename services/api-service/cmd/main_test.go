package main

import (
	"bytes"
	"context"
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

type fakeDatabase struct {
	name string
	err  error
}

func (f *fakePublisher) Publish(_ context.Context, msg *pubsub.Message) publishResult {
	f.lastPayload = msg.Data
	return f.result
}

func (f fakeDatabase) Name() string {
	return f.name
}

func (f fakeDatabase) Ping(context.Context) error {
	return f.err
}

func (f fakeDatabase) VerifyReadWrite(context.Context, string) error {
	return f.err
}

func (f fakeDatabase) Close(context.Context) error {
	return nil
}

func TestPublishRequiresDocumentID(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/publish", bytes.NewBufferString(`{"fileName":"notes.pdf"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPublishReturnsAcceptedResponse(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/publish", bytes.NewBufferString(`{"documentId":"doc-42","fileName":"week1.pdf","source":"web"}`))
	rec := httptest.NewRecorder()

	fake := &fakePublisher{result: fakePublishResult{id: "msg-123"}}
	newServer(context.Background(), fake, "pubsub", nil).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	body := rec.Body.String()
	if !bytes.Contains([]byte(body), []byte(`"messageId":"msg-123"`)) {
		t.Fatalf("expected message id in response, got %s", body)
	}
	if !bytes.Contains([]byte(body), []byte(`"documentId":"doc-42"`)) {
		t.Fatalf("expected documentId in response, got %s", body)
	}
	if !bytes.Contains(fake.lastPayload, []byte(`"documentId":"doc-42"`)) {
		t.Fatalf("expected payload to include documentId, got %s", string(fake.lastPayload))
	}
}

func TestCORSPreflightReturnsNoContent(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/publish", nil)
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil).ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}

	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("expected wildcard cors header, got %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestReadyReportsMongoDBNotConfigured(t *testing.T) {
	t.Setenv("MONGODB_HOST", "")

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	rec := httptest.NewRecorder()

	fake := &fakePublisher{result: fakePublishResult{id: "msg-123"}}
	newServer(context.Background(), fake, "pubsub", nil).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	body := rec.Body.String()
	if !bytes.Contains([]byte(body), []byte(`"databaseStatus":"not_configured"`)) {
		t.Fatalf("expected databaseStatus in response, got %s", body)
	}
}

func TestReadyReportsMongoDBReady(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	rec := httptest.NewRecorder()

	fake := &fakePublisher{result: fakePublishResult{id: "msg-123"}}
	db := fakeDatabase{name: "examflow"}
	newServer(context.Background(), fake, "pubsub", db).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	body := rec.Body.String()
	if !bytes.Contains([]byte(body), []byte(`"databaseStatus":"ready"`)) {
		t.Fatalf("expected ready databaseStatus in response, got %s", body)
	}
}

func TestReadyReportsMongoDBUnavailable(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	rec := httptest.NewRecorder()

	fake := &fakePublisher{result: fakePublishResult{id: "msg-123"}}
	db := fakeDatabase{name: "examflow", err: errors.New("database unavailable")}
	newServer(context.Background(), fake, "pubsub", db).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}

	body := rec.Body.String()
	if !bytes.Contains([]byte(body), []byte(`"databaseStatus":"unreachable"`)) {
		t.Fatalf("expected unreachable databaseStatus in response, got %s", body)
	}
}
