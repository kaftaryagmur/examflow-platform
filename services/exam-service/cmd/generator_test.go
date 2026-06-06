package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

const validToolResponse = `{
	"stop_reason":"tool_use",
	"model":"claude-opus-4-8",
	"content":[
		{"type":"tool_use","name":"submit_exam_content","input":{
			"questions":[{"question":"Soru?","options":["A","B","C","D"],"correctAnswer":"A","explanation":"Cunku.","difficulty":"medium","topic":"Konu"}],
			"infoCards":[{"title":"Kart","summary":"Ozet","keyPoints":["Nokta"]}]
		}}
	]
}`

func TestClaudeQuestionGeneratorGeneratesStructuredContent(t *testing.T) {
	var capturedBody []byte
	var capturedHeaders http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(validToolResponse))
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
	// No file content -> metadata path, content is a plain string mentioning the file name.
	contentStr, ok := sent.Messages[0].Content.(string)
	if !ok {
		t.Fatalf("expected metadata string content, got %T", sent.Messages[0].Content)
	}
	if !strings.Contains(contentStr, "week1.pdf") {
		t.Fatalf("expected user prompt to include file name, got %q", contentStr)
	}
}

func TestClaudeQuestionGeneratorSendsPdfAsDocumentBlock(t *testing.T) {
	var capturedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(validToolResponse))
	}))
	defer server.Close()

	gen := newClaudeQuestionGenerator("test-key", "", server.URL)
	_, err := gen.Generate(context.Background(), GenerationInput{
		DocumentID:  "doc-pdf",
		FileName:    "week1.pdf",
		ContentType: "application/pdf",
		FileContent: []byte("%PDF-1.4 some real pdf bytes"),
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	var sent anthropicRequest
	if err := json.Unmarshal(capturedBody, &sent); err != nil {
		t.Fatalf("decode sent body: %v", err)
	}
	blocks, ok := sent.Messages[0].Content.([]any)
	if !ok {
		t.Fatalf("expected content blocks array for PDF, got %T", sent.Messages[0].Content)
	}
	first, ok := blocks[0].(map[string]any)
	if !ok || first["type"] != "document" {
		t.Fatalf("expected first block to be a document, got %+v", blocks[0])
	}
	source, ok := first["source"].(map[string]any)
	if !ok || source["media_type"] != "application/pdf" {
		t.Fatalf("expected pdf media type, got %+v", first["source"])
	}
	if data, _ := source["data"].(string); data == "" {
		t.Fatal("expected base64 pdf data in document block")
	}
}

func TestClaudeQuestionGeneratorExtractsDocxText(t *testing.T) {
	docx := buildTestDocx(t, "Hucre zarinin gorevleri")

	var capturedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(validToolResponse))
	}))
	defer server.Close()

	gen := newClaudeQuestionGenerator("test-key", "", server.URL)
	_, err := gen.Generate(context.Background(), GenerationInput{
		DocumentID:  "doc-docx",
		FileName:    "biyoloji.docx",
		ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		FileContent: docx,
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	var sent anthropicRequest
	if err := json.Unmarshal(capturedBody, &sent); err != nil {
		t.Fatalf("decode sent body: %v", err)
	}
	contentStr, ok := sent.Messages[0].Content.(string)
	if !ok {
		t.Fatalf("expected docx text prompt as string, got %T", sent.Messages[0].Content)
	}
	if !strings.Contains(contentStr, "Hucre zarinin gorevleri") {
		t.Fatalf("expected extracted docx text in prompt, got %q", contentStr)
	}
}

func TestClaudeQuestionGeneratorRetriesOnServerError(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(validToolResponse))
	}))
	defer server.Close()

	gen := newClaudeQuestionGenerator("test-key", "", server.URL)
	content, err := gen.Generate(context.Background(), GenerationInput{DocumentID: "doc-retry"})
	if err != nil {
		t.Fatalf("expected success after retry, got %v", err)
	}
	if len(content.Questions) != 1 {
		t.Fatalf("expected questions after retry, got %+v", content.Questions)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("expected 2 calls (1 fail + 1 retry), got %d", got)
	}
}

func TestClaudeQuestionGeneratorDoesNotRetryOnAuthError(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`))
	}))
	defer server.Close()

	gen := newClaudeQuestionGenerator("bad-key", "", server.URL)
	if _, err := gen.Generate(context.Background(), GenerationInput{DocumentID: "doc-1"}); err == nil {
		t.Fatal("expected error on 401 response")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("expected exactly 1 call (no retry on 401), got %d", got)
	}
}

func TestClaudeQuestionGeneratorRequiresAPIKey(t *testing.T) {
	gen := newClaudeQuestionGenerator("", "", "")
	if _, err := gen.Generate(context.Background(), GenerationInput{DocumentID: "doc-1"}); err == nil {
		t.Fatal("expected error when api key missing")
	}
}

func TestValidateGeneratedContentDropsInvalidQuestions(t *testing.T) {
	out, err := validateGeneratedContent(GeneratedContent{
		Questions: []ExamQuestion{
			{Question: "Gecerli soru?", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "b", Difficulty: "HARD", Topic: "Konu", Explanation: "E"},
			{Question: "Eksik secenek", Options: []string{"A", "B", "C"}, CorrectAnswer: "A", Difficulty: "easy", Topic: "x"},
			{Question: "", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "A", Difficulty: "easy", Topic: "x"},
			{Question: "Gecersiz cevap", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "Z", Difficulty: "easy", Topic: "x"},
		},
		InfoCards: []ExamInfoCard{{Title: "Kart", Summary: "Ozet", KeyPoints: []string{"k", ""}}},
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(out.Questions) != 1 {
		t.Fatalf("expected only the valid question to survive, got %d", len(out.Questions))
	}
	q := out.Questions[0]
	if q.CorrectAnswer != "B" {
		t.Fatalf("expected normalized answer B, got %q", q.CorrectAnswer)
	}
	if q.Difficulty != "hard" {
		t.Fatalf("expected normalized difficulty hard, got %q", q.Difficulty)
	}
	if len(out.InfoCards) != 1 || len(out.InfoCards[0].KeyPoints) != 1 {
		t.Fatalf("expected info card with blank key point dropped, got %+v", out.InfoCards)
	}
}

func TestValidateGeneratedContentErrorsWhenNoValidQuestions(t *testing.T) {
	_, err := validateGeneratedContent(GeneratedContent{
		Questions: []ExamQuestion{
			{Question: "Eksik", Options: []string{"A", "B"}, CorrectAnswer: "A"},
		},
	})
	if err == nil {
		t.Fatal("expected error when no valid questions remain")
	}
}

func buildTestDocx(t *testing.T, text string) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	part, err := writer.Create("word/document.xml")
	if err != nil {
		t.Fatalf("create docx part: %v", err)
	}
	doc := `<?xml version="1.0" encoding="UTF-8"?>` +
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:body><w:p><w:r><w:t>` + text + `</w:t></w:r></w:p></w:body></w:document>`
	if _, err := part.Write([]byte(doc)); err != nil {
		t.Fatalf("write docx part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close docx zip: %v", err)
	}
	return buf.Bytes()
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

type stubFileReader struct {
	data []byte
	err  error
}

func (s stubFileReader) DownloadFile(context.Context, bson.ObjectID, int64) ([]byte, error) {
	return s.data, s.err
}

type capturingExamStore struct {
	saved []Exam
}

func (c *capturingExamStore) Save(_ context.Context, exam Exam) error {
	c.saved = append(c.saved, exam)
	return nil
}

func TestHandleValidatedMessageAttachesGeneratedContent(t *testing.T) {
	prevExams, prevDocs, prevFiles, prevGen := exams, documents, files, generator
	defer func() { exams, documents, files, generator = prevExams, prevDocs, prevFiles, prevGen }()

	store := &capturingExamStore{}
	gen := &stubGenerator{content: GeneratedContent{
		Questions: []ExamQuestion{{Question: "Q", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "A", Explanation: "E", Difficulty: "easy", Topic: "T"}},
		InfoCards: []ExamInfoCard{{Title: "C", Summary: "S", KeyPoints: []string{"K"}}},
	}}
	fileID := bson.NewObjectID()
	exams = store
	documents = stubDocumentReader{doc: Document{DocumentID: "doc-77", FileID: fileID, FileName: "week1.pdf", ContentType: "application/pdf", Source: "web"}}
	files = stubFileReader{data: []byte("%PDF-1.4 content")}
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
	if saved.GenerationModel != "stub-model" {
		t.Fatalf("expected generation model recorded, got %q", saved.GenerationModel)
	}
	if !gen.called {
		t.Fatal("expected generator to be called")
	}
	if gen.lastInput.FileName != "week1.pdf" {
		t.Fatalf("expected file name passed to generator, got %q", gen.lastInput.FileName)
	}
	if !bytes.Equal(gen.lastInput.FileContent, []byte("%PDF-1.4 content")) {
		t.Fatalf("expected document content passed to generator, got %q", gen.lastInput.FileContent)
	}
	if gen.lastInput.ContentType != "application/pdf" {
		t.Fatalf("expected content type passed to generator, got %q", gen.lastInput.ContentType)
	}
}

func TestHandleValidatedMessageGracefullySkipsOnGeneratorError(t *testing.T) {
	prevExams, prevDocs, prevFiles, prevGen := exams, documents, files, generator
	defer func() { exams, documents, files, generator = prevExams, prevDocs, prevFiles, prevGen }()

	store := &capturingExamStore{}
	exams = store
	documents = nil
	files = nil
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
