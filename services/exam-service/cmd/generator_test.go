package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestClaudeQuestionGeneratorGeneratesStructuredContent(t *testing.T) {
	var capturedBody []byte
	var capturedHeaders http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"stop_reason":"tool_use",
			"model":"claude-opus-4-8",
			"content":[
				{"type":"tool_use","name":"submit_exam_content","input":{
					"questions":[{"question":"Soru?","options":["A","B","C","D"],"correctAnswer":"A","explanation":"Cunku.","difficulty":"medium","topic":"Konu"}],
					"infoCards":[{"title":"Kart","summary":"Ozet","keyPoints":["Nokta"]}]
				}}
			]
		}`))
	}))
	defer server.Close()

	gen := newClaudeQuestionGenerator("test-key", "", server.URL)
	content, err := gen.Generate(context.Background(), GenerationInput{DocumentID: "doc-1", FileName: "week1.pdf", Source: "web"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(content.Questions) != 1 || content.Questions[0].CorrectAnswer != "A" {
		t.Fatalf("unexpected questions: %+v", content.Questions)
	}
	if len(content.InfoCards) != 1 || content.InfoCards[0].Title != "Kart" {
		t.Fatalf("unexpected info cards: %+v", content.InfoCards)
	}

	if capturedHeaders.Get("x-api-key") != "test-key" {
		t.Fatalf("expected api key header, got %q", capturedHeaders.Get("x-api-key"))
	}
	if capturedHeaders.Get("anthropic-version") != anthropicAPIVersion {
		t.Fatalf("expected anthropic-version header, got %q", capturedHeaders.Get("anthropic-version"))
	}

	var sent anthropicRequest
	if err := json.Unmarshal(capturedBody, &sent); err != nil {
		t.Fatalf("decode sent body: %v", err)
	}
	if sent.Model != defaultAnthropicModel {
		t.Fatalf("expected default model %q, got %q", defaultAnthropicModel, sent.Model)
	}
	if sent.ToolChoice == nil || sent.ToolChoice.Name != generationToolName {
		t.Fatalf("expected forced tool choice %q, got %+v", generationToolName, sent.ToolChoice)
	}
	if !strings.Contains(sent.Messages[0].Content, "week1.pdf") {
		t.Fatalf("expected user prompt to include file name, got %q", sent.Messages[0].Content)
	}
}

func TestClaudeQuestionGeneratorErrorsOnAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`))
	}))
	defer server.Close()

	gen := newClaudeQuestionGenerator("bad-key", "", server.URL)
	if _, err := gen.Generate(context.Background(), GenerationInput{DocumentID: "doc-1"}); err == nil {
		t.Fatal("expected error on 401 response")
	}
}

func TestClaudeQuestionGeneratorRequiresAPIKey(t *testing.T) {
	gen := newClaudeQuestionGenerator("", "", "")
	if _, err := gen.Generate(context.Background(), GenerationInput{DocumentID: "doc-1"}); err == nil {
		t.Fatal("expected error when api key missing")
	}
}

type stubGenerator struct {
	content   GeneratedContent
	err       error
	called    bool
	lastInput GenerationInput
}

func (s *stubGenerator) Generate(_ context.Context, in GenerationInput) (GeneratedContent, error) {
	s.called = true
	s.lastInput = in
	return s.content, s.err
}

func (s *stubGenerator) Model() string { return "stub-model" }

type stubDocumentReader struct {
	doc Document
	err error
}

func (s stubDocumentReader) FindByDocumentID(context.Context, string, string) (Document, error) {
	return s.doc, s.err
}

type capturingExamStore struct {
	saved []Exam
}

func (c *capturingExamStore) Save(_ context.Context, exam Exam) error {
	c.saved = append(c.saved, exam)
	return nil
}

func TestHandleValidatedMessageAttachesGeneratedContent(t *testing.T) {
	prevExams, prevDocs, prevGen := exams, documents, generator
	defer func() { exams, documents, generator = prevExams, prevDocs, prevGen }()

	store := &capturingExamStore{}
	gen := &stubGenerator{content: GeneratedContent{
		Questions: []ExamQuestion{{Question: "Q", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "A", Explanation: "E", Difficulty: "easy", Topic: "T"}},
		InfoCards: []ExamInfoCard{{Title: "C", Summary: "S", KeyPoints: []string{"K"}}},
	}}
	exams = store
	documents = stubDocumentReader{doc: Document{FileName: "week1.pdf", Source: "web"}}
	generator = gen

	payload, _ := json.Marshal(map[string]string{
		"documentId":       "doc-77",
		"userId":           bson.NewObjectID().Hex(),
		"eventType":        "exam.validation.completed",
		"validationResult": "valid",
	})
	msg := &fakeMessage{id: "msg-gen", data: payload}
	handleValidatedMessage(msg)

	if !msg.acked {
		t.Fatal("expected message to be acked")
	}
	if len(store.saved) != 1 {
		t.Fatalf("expected one saved exam, got %d", len(store.saved))
	}
	saved := store.saved[0]
	if len(saved.Questions) != 1 || saved.Questions[0].CorrectAnswer != "A" {
		t.Fatalf("expected generated question persisted, got %+v", saved.Questions)
	}
	if len(saved.InfoCards) != 1 || saved.InfoCards[0].Title != "C" {
		t.Fatalf("expected generated info card persisted, got %+v", saved.InfoCards)
	}
	if saved.GenerationModel != "stub-model" {
		t.Fatalf("expected generation model recorded, got %q", saved.GenerationModel)
	}
	if !gen.called {
		t.Fatal("expected generator to be called")
	}
	if gen.lastInput.FileName != "week1.pdf" {
		t.Fatalf("expected file name passed to generator, got %q", gen.lastInput.FileName)
	}
}

func TestHandleValidatedMessageGracefullySkipsOnGeneratorError(t *testing.T) {
	prevExams, prevDocs, prevGen := exams, documents, generator
	defer func() { exams, documents, generator = prevExams, prevDocs, prevGen }()

	store := &capturingExamStore{}
	exams = store
	documents = nil
	generator = &stubGenerator{err: errors.New("boom")}

	payload, _ := json.Marshal(map[string]string{
		"documentId":       "doc-78",
		"userId":           bson.NewObjectID().Hex(),
		"eventType":        "exam.validation.completed",
		"validationResult": "valid",
	})
	msg := &fakeMessage{id: "msg-err", data: payload}
	handleValidatedMessage(msg)

	if !msg.acked {
		t.Fatal("expected message to be acked even when generation fails")
	}
	if len(store.saved) != 1 || len(store.saved[0].Questions) != 0 {
		t.Fatalf("expected exam persisted without questions, got %+v", store.saved)
	}
}

func TestHandleValidatedMessageSkipsGenerationForFailedValidation(t *testing.T) {
	prevExams, prevGen := exams, generator
	defer func() { exams, generator = prevExams, prevGen }()

	store := &capturingExamStore{}
	gen := &stubGenerator{}
	exams = store
	generator = gen

	payload, _ := json.Marshal(map[string]string{
		"documentId":       "doc-79",
		"userId":           bson.NewObjectID().Hex(),
		"eventType":        "exam.validation.completed",
		"validationResult": "invalid",
	})
	msg := &fakeMessage{id: "msg-failed", data: payload}
	handleValidatedMessage(msg)

	if gen.called {
		t.Fatal("did not expect generator to run for failed validation")
	}
	if len(store.saved) != 1 || store.saved[0].Status != examStatusFailed {
		t.Fatalf("expected failed exam saved, got %+v", store.saved)
	}
}
