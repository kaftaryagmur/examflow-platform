package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	defaultAnthropicBaseURL = "https://api.anthropic.com"
	defaultAnthropicModel   = "claude-opus-4-8"
	anthropicAPIVersion     = "2023-06-01"

	// generationToolName is the single forced tool the model must call. Forcing
	// a tool with a strict input_schema is how we guarantee structured JSON
	// instead of free-form prose we would have to parse defensively.
	generationToolName = "submit_exam_content"

	maxGenerationAttempts = 3        // 1 initial + 2 retries
	maxDocumentBytes      = 20 << 20 // skip inline document content above this
	maxDocxTextChars      = 40000    // bound prompt size for extracted DOCX text
)

// GenerationInput is the document context handed to the model. When FileContent
// is present generation is driven by the real document content; otherwise it
// falls back to metadata (file name / source).
type GenerationInput struct {
	DocumentID  string
	FileName    string
	Source      string
	ContentType string
	FileContent []byte
	Prefs       GenerationPrefs
}

// questionGenerator turns a document into structured exam content.
type questionGenerator interface {
	Generate(context.Context, GenerationInput) (GeneratedContent, error)
	Model() string
}

// claudeQuestionGenerator calls the Anthropic Messages API over plain net/http
// (no SDK) following the documented wire format.
type claudeQuestionGenerator struct {
	apiKey     string
	model      string
	baseURL    string
	httpClient *http.Client
}

func newClaudeQuestionGenerator(apiKey, model, baseURL string) *claudeQuestionGenerator {
	if strings.TrimSpace(model) == "" {
		model = defaultAnthropicModel
	}
	if strings.TrimSpace(baseURL) == "" {
		baseURL = defaultAnthropicBaseURL
	}
	return &claudeQuestionGenerator{
		apiKey:     strings.TrimSpace(apiKey),
		model:      strings.TrimSpace(model),
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		httpClient: &http.Client{Timeout: 90 * time.Second},
	}
}

func (g *claudeQuestionGenerator) Model() string { return g.model }

type anthropicTextBlock struct {
	Type         string                 `json:"type"`
	Text         string                 `json:"text"`
	CacheControl *anthropicCacheControl `json:"cache_control,omitempty"`
}

type anthropicCacheControl struct {
	Type string `json:"type"`
}

// anthropicMessage.Content is either a plain string or a slice of content
// blocks (text + document), so it is typed as any.
type anthropicMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type anthropicTextContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicDocumentContentBlock struct {
	Type   string                  `json:"type"`
	Source anthropicDocumentSource `json:"source"`
}

type anthropicDocumentSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

type anthropicTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

type anthropicToolChoice struct {
	Type string `json:"type"`
	Name string `json:"name,omitempty"`
}

type anthropicRequest struct {
	Model      string               `json:"model"`
	MaxTokens  int                  `json:"max_tokens"`
	System     []anthropicTextBlock `json:"system,omitempty"`
	Messages   []anthropicMessage   `json:"messages"`
	Tools      []anthropicTool      `json:"tools,omitempty"`
	ToolChoice *anthropicToolChoice `json:"tool_choice,omitempty"`
}

type anthropicResponseBlock struct {
	Type  string          `json:"type"`
	Text  string          `json:"text"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

type anthropicResponse struct {
	Content    []anthropicResponseBlock `json:"content"`
	StopReason string                   `json:"stop_reason"`
	Model      string                   `json:"model"`
	Error      *anthropicErrorBody      `json:"error"`
}

type anthropicErrorBody struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

func (g *claudeQuestionGenerator) Generate(ctx context.Context, input GenerationInput) (GeneratedContent, error) {
	if g.apiKey == "" {
		return GeneratedContent{}, fmt.Errorf("anthropic api key not configured")
	}

	messages, mode := g.buildMessages(input)
	payload := anthropicRequest{
		Model:     g.model,
		MaxTokens: 4096,
		System: []anthropicTextBlock{
			{
				Type: "text",
				Text: generationSystemPrompt,
				// The system prompt is identical for every document, so it is the
				// stable cache prefix. Caching only kicks in once the prefix exceeds
				// the model's minimum cacheable size; harmless otherwise.
				CacheControl: &anthropicCacheControl{Type: "ephemeral"},
			},
		},
		Messages:   messages,
		Tools:      []anthropicTool{generationTool()},
		ToolChoice: &anthropicToolChoice{Type: "tool", Name: generationToolName},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return GeneratedContent{}, fmt.Errorf("marshal request: %w", err)
	}

	// Retry transient HTTP failures (429/5xx, network) and faulty/incomplete
	// model output (missing tool call, no valid questions). Permanent client
	// errors (400/401/403) are not retried.
	var lastErr error
	for attempt := 0; attempt < maxGenerationAttempts; attempt++ {
		if attempt > 0 {
			if err := sleepWithContext(ctx, backoffDelay(attempt)); err != nil {
				return GeneratedContent{}, err
			}
		}

		responseBody, status, err := g.doRequest(ctx, body)
		if err != nil {
			lastErr = fmt.Errorf("call anthropic (mode=%s): %w", mode, err)
			continue // network error: retry
		}
		if status != http.StatusOK {
			lastErr = fmt.Errorf("anthropic returned status %d: %s", status, strings.TrimSpace(string(responseBody)))
			if isRetryableStatus(status) {
				continue
			}
			return GeneratedContent{}, lastErr // permanent error
		}

		content, err := parseGeneratedContent(responseBody)
		if err != nil {
			lastErr = err
			continue // faulty/incomplete output: retry
		}
		return content, nil
	}

	return GeneratedContent{}, fmt.Errorf("generation failed after %d attempts: %w", maxGenerationAttempts, lastErr)
}

func (g *claudeQuestionGenerator) doRequest(ctx context.Context, body []byte) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, 0, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", g.apiKey)
	req.Header.Set("anthropic-version", anthropicAPIVersion)

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}
	return responseBody, resp.StatusCode, nil
}

// parseGeneratedContent extracts the forced tool call's structured input and
// validates it. Returns an error for faulty/incomplete output so the caller can
// retry.
func parseGeneratedContent(responseBody []byte) (GeneratedContent, error) {
	var decoded anthropicResponse
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return GeneratedContent{}, fmt.Errorf("decode response: %w", err)
	}
	if decoded.Error != nil {
		return GeneratedContent{}, fmt.Errorf("anthropic error %s: %s", decoded.Error.Type, decoded.Error.Message)
	}

	for _, block := range decoded.Content {
		if block.Type != "tool_use" || block.Name != generationToolName {
			continue
		}
		var content GeneratedContent
		if err := json.Unmarshal(block.Input, &content); err != nil {
			return GeneratedContent{}, fmt.Errorf("decode tool input: %w", err)
		}
		return validateGeneratedContent(content)
	}
	return GeneratedContent{}, fmt.Errorf("model did not call %s tool (stop_reason=%s)", generationToolName, decoded.StopReason)
}

// validateGeneratedContent enforces the contract beyond what the JSON schema
// guarantees: exactly 4 options, an A-D answer, a known difficulty. Invalid
// questions are dropped; if none survive the output is treated as faulty.
func validateGeneratedContent(c GeneratedContent) (GeneratedContent, error) {
	validDifficulty := map[string]bool{"easy": true, "medium": true, "hard": true}

	var out GeneratedContent
	for _, q := range c.Questions {
		question := strings.TrimSpace(q.Question)
		if question == "" {
			continue
		}

		options := make([]string, 0, len(q.Options))
		for _, o := range q.Options {
			if s := strings.TrimSpace(o); s != "" {
				options = append(options, s)
			}
		}
		if len(options) != 4 {
			continue
		}

		answer := strings.ToUpper(strings.TrimSpace(q.CorrectAnswer))
		if answer != "A" && answer != "B" && answer != "C" && answer != "D" {
			continue
		}

		difficulty := strings.ToLower(strings.TrimSpace(q.Difficulty))
		if !validDifficulty[difficulty] {
			difficulty = "medium"
		}
		topic := strings.TrimSpace(q.Topic)
		if topic == "" {
			topic = "Genel"
		}

		out.Questions = append(out.Questions, ExamQuestion{
			Question:      question,
			Options:       options,
			CorrectAnswer: answer,
			Explanation:   strings.TrimSpace(q.Explanation),
			Difficulty:    difficulty,
			Topic:         topic,
		})
	}

	if len(out.Questions) == 0 {
		return GeneratedContent{}, fmt.Errorf("no valid questions after validation")
	}

	for _, card := range c.InfoCards {
		title := strings.TrimSpace(card.Title)
		summary := strings.TrimSpace(card.Summary)
		if title == "" && summary == "" {
			continue
		}
		keyPoints := make([]string, 0, len(card.KeyPoints))
		for _, p := range card.KeyPoints {
			if s := strings.TrimSpace(p); s != "" {
				keyPoints = append(keyPoints, s)
			}
		}
		out.InfoCards = append(out.InfoCards, ExamInfoCard{Title: title, Summary: summary, KeyPoints: keyPoints})
	}

	return out, nil
}

// buildMessages chooses the richest available input: the PDF as a native
// document block, extracted DOCX text, or metadata-only as a last resort.
func (g *claudeQuestionGenerator) buildMessages(input GenerationInput) ([]anthropicMessage, string) {
	if len(input.FileContent) > 0 && len(input.FileContent) <= maxDocumentBytes {
		if looksLikePDF(input) {
			content := []any{
				anthropicDocumentContentBlock{
					Type:   "document",
					Source: anthropicDocumentSource{Type: "base64", MediaType: "application/pdf", Data: base64.StdEncoding.EncodeToString(input.FileContent)},
				},
				anthropicTextContentBlock{Type: "text", Text: buildContentInstruction(input)},
			}
			return []anthropicMessage{{Role: "user", Content: content}}, "pdf-document"
		}
		if looksLikeDOCX(input) {
			if text, err := extractDocxText(input.FileContent); err == nil {
				if trimmed := strings.TrimSpace(text); trimmed != "" {
					prompt := buildContentInstruction(input) + "\n\nDoküman metni:\n" + truncateText(trimmed, maxDocxTextChars)
					return []anthropicMessage{{Role: "user", Content: prompt}}, "docx-text"
				}
			}
		}
	}
	return []anthropicMessage{{Role: "user", Content: buildMetadataPrompt(input)}}, "metadata"
}

const generationSystemPrompt = `Sen ExamFlow platformu için çalışan bir sınav hazırlama asistanısın.
Sana verilen dokümanın İÇERİĞİNDEN (PDF veya çıkarılmış metin) Türkçe çoktan
seçmeli sorular ve kısa çalışma kartları üretirsin. Doküman içeriği verilmemişse
yalnızca dosya adı/metadata'dan konuyu çıkarırsın. Çıktıyı yalnızca
submit_exam_content aracını çağırarak verirsin; serbest metin yazmazsın.

Kurallar:
- İstenen sayıda çoktan seçmeli soru üret (sayı ve zorluk istek mesajında belirtilir).
- Her sorunun tam olarak 4 seçeneği olsun.
- correctAnswer alanı doğru seçeneğin harfi olsun: A, B, C veya D.
- difficulty yalnızca easy, medium veya hard değerlerinden biri olsun.
- topic kısa bir konu etiketi olsun; explanation alanı bos birakilmasin.
- İstenen sayıda bilgi kartı üret; her kartta başlık, tek cümlelik özet ve 2-4 anahtar nokta olsun.
- Sorular ve kartlar dokümanın gerçek içeriğine dayansın, eğitici ve kendi içinde tutarlı olsun.`

func buildContentInstruction(input GenerationInput) string {
	return fmt.Sprintf(`Sağlanan dokümanın içeriğine dayanarak sınav içeriği üret.
documentId: %s
dosya adı: %s

%s`, strings.TrimSpace(input.DocumentID), fileNameOrUnknown(input.FileName), prefsInstruction(input.Prefs))
}

func buildMetadataPrompt(input GenerationInput) string {
	return fmt.Sprintf(`Aşağıdaki doküman için sınav içeriği üret.
documentId: %s
dosya adı: %s
kaynak: %s
Dokümanın metni elimizde yok; konuyu dosya adından çıkar.

%s`,
		strings.TrimSpace(input.DocumentID), fileNameOrUnknown(input.FileName), sourceOrUnknown(input.Source), prefsInstruction(input.Prefs))
}

func prefsInstruction(prefs GenerationPrefs) string {
	prefs = resolveGenerationPrefs(prefs)
	var b strings.Builder
	fmt.Fprintf(&b, "Tam olarak %d adet çoktan seçmeli soru üret.\n", prefs.QuestionCount)
	b.WriteString(difficultyInstruction(prefs.Difficulty))
	fmt.Fprintf(&b, "\n%d adet bilgi kartı üret.", prefs.InfoCardCount)
	if prefs.Focus != "" {
		fmt.Fprintf(&b, "\nÖzellikle şu konuya/talimata odaklan: %s", prefs.Focus)
	}
	return b.String()
}

func difficultyInstruction(difficulty string) string {
	switch difficulty {
	case difficultyEasy:
		return "Tüm sorular kolay (easy) zorlukta olsun."
	case difficultyMedium:
		return "Tüm sorular orta (medium) zorlukta olsun."
	case difficultyHard:
		return "Tüm sorular zor (hard) zorlukta olsun."
	default:
		return "Soruları kolay, orta ve zor arasında dengeli dağıt (karışık)."
	}
}

func fileNameOrUnknown(name string) string {
	if s := strings.TrimSpace(name); s != "" {
		return s
	}
	return "(bilinmiyor)"
}

func sourceOrUnknown(source string) string {
	if s := strings.TrimSpace(source); s != "" {
		return s
	}
	return "(bilinmiyor)"
}

func looksLikePDF(input GenerationInput) bool {
	if strings.Contains(strings.ToLower(input.ContentType), "pdf") {
		return true
	}
	if strings.HasSuffix(strings.ToLower(strings.TrimSpace(input.FileName)), ".pdf") {
		return true
	}
	return bytes.HasPrefix(input.FileContent, []byte("%PDF"))
}

func looksLikeDOCX(input GenerationInput) bool {
	if strings.Contains(strings.ToLower(input.ContentType), "wordprocessingml") {
		return true
	}
	return strings.HasSuffix(strings.ToLower(strings.TrimSpace(input.FileName)), ".docx")
}

// extractDocxText pulls the visible text out of a .docx (a zip whose
// word/document.xml holds the body) using only the standard library.
func extractDocxText(data []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("open docx zip: %w", err)
	}

	var documentFile *zip.File
	for _, f := range reader.File {
		if f.Name == "word/document.xml" {
			documentFile = f
			break
		}
	}
	if documentFile == nil {
		return "", fmt.Errorf("docx has no word/document.xml")
	}

	rc, err := documentFile.Open()
	if err != nil {
		return "", fmt.Errorf("open document.xml: %w", err)
	}
	defer rc.Close()

	decoder := xml.NewDecoder(rc)
	var builder strings.Builder
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("parse document.xml: %w", err)
		}
		switch t := token.(type) {
		case xml.CharData:
			builder.Write(t)
		case xml.EndElement:
			// w:p is a paragraph, w:br/w:tab are breaks — turn them into spacing.
			switch t.Name.Local {
			case "p":
				builder.WriteString("\n")
			case "br", "tab":
				builder.WriteString(" ")
			}
		}
	}
	return builder.String(), nil
}

func truncateText(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func isRetryableStatus(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500
}

func backoffDelay(attempt int) time.Duration {
	// attempt is 1-based for retries: 1s, then 2s.
	return time.Duration(attempt) * time.Second
}

func sleepWithContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func generationTool() anthropicTool {
	stringSchema := map[string]any{"type": "string"}
	return anthropicTool{
		Name:        generationToolName,
		Description: "Üretilen sınav sorularını ve bilgi kartlarını yapılandırılmış olarak gönderir.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"questions": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"question": stringSchema,
							"options": map[string]any{
								"type":     "array",
								"items":    stringSchema,
								"minItems": 4,
								"maxItems": 4,
							},
							"correctAnswer": map[string]any{
								"type": "string",
								"enum": []string{"A", "B", "C", "D"},
							},
							"explanation": stringSchema,
							"difficulty": map[string]any{
								"type": "string",
								"enum": []string{"easy", "medium", "hard"},
							},
							"topic": stringSchema,
						},
						"required": []string{"question", "options", "correctAnswer", "explanation", "difficulty", "topic"},
					},
				},
				"infoCards": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"title":   stringSchema,
							"summary": stringSchema,
							"keyPoints": map[string]any{
								"type":  "array",
								"items": stringSchema,
							},
						},
						"required": []string{"title", "summary", "keyPoints"},
					},
				},
			},
			"required": []string{"questions", "infoCards"},
		},
	}
}
