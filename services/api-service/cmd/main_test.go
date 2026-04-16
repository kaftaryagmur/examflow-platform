package main

import (
	"bytes"
	"context"
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

func TestPublishRequiresDocumentID(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/publish", bytes.NewBufferString(`{"fileName":"notes.pdf"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock").ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPublishReturnsAcceptedResponse(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/publish", bytes.NewBufferString(`{"documentId":"doc-42","fileName":"week1.pdf","source":"web"}`))
	rec := httptest.NewRecorder()

	fake := &fakePublisher{result: fakePublishResult{id: "msg-123"}}
	newServer(context.Background(), fake, "pubsub").ServeHTTP(rec, req)

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

	newServer(context.Background(), nil, "mock").ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}

	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("expected wildcard cors header, got %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}
