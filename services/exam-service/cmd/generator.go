package main

import (
	"bytes"
	"context"
	"encoding/json"
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
)

// GenerationInput is the document context handed to the model. The pipeline does
// not carry extracted document text, so generation is driven by metadata.
type GenerationInput struct {
	DocumentID string
	FileName   string
	Source     string
}

// questionGenerator turns document metadata into structured exam content.
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
		httpClient: &http.Client{Timeout: 60 * time.Second},
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

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
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
		Messages: []anthropicMessage{
			{Role: "user", Content: buildGenerationUserPrompt(input)},
		},
		Tools:      []anthropicTool{generationTool()},
		ToolChoice: &anthropicToolChoice{Type: "tool", Name: generationToolName},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return GeneratedContent{}, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.baseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return GeneratedContent{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", g.apiKey)
	req.Header.Set("anthropic-version", anthropicAPIVersion)

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return GeneratedContent{}, fmt.Errorf("call anthropic: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return GeneratedContent{}, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return GeneratedContent{}, fmt.Errorf("anthropic returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}

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
		if len(content.Questions) == 0 {
			return GeneratedContent{}, fmt.Errorf("model returned no questions")
		}
		return content, nil
	}

	return GeneratedContent{}, fmt.Errorf("model did not call %s tool (stop_reason=%s)", generationToolName, decoded.StopReason)
}

const generationSystemPrompt = `Sen ExamFlow platformu için çalışan bir sınav hazırlama asistanısın.
Sana verilen doküman metadata bilgisinden (dosya adı, kaynak) yola çıkarak Türkçe
çoktan seçmeli sorular ve kısa çalışma kartları üretirsin. Çıktıyı yalnızca
submit_exam_content aracını çağırarak verirsin; serbest metin yazmazsın.

Kurallar:
- 4 ile 6 arası çoktan seçmeli soru üret.
- Her sorunun tam olarak 4 seçeneği olsun.
- correctAnswer alanı doğru seçeneğin harfi olsun: A, B, C veya D.
- difficulty yalnızca easy, medium veya hard değerlerinden biri olsun.
- topic kısa bir konu etiketi olsun.
- 2 ile 3 arası bilgi kartı üret; her kartta başlık, tek cümlelik özet ve 2-4 anahtar nokta olsun.
- İçeriği dosya adından çıkardığın konuya dayandır, eğitici ve kendi içinde tutarlı tut.`

func buildGenerationUserPrompt(input GenerationInput) string {
	fileName := strings.TrimSpace(input.FileName)
	if fileName == "" {
		fileName = "(bilinmiyor)"
	}
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "(bilinmiyor)"
	}
	return fmt.Sprintf(`Aşağıdaki doküman için sınav içeriği üret.
documentId: %s
dosya adı: %s
kaynak: %s

Dokümanın metni elimizde yok; konuyu dosya adından çıkar.`,
		strings.TrimSpace(input.DocumentID), fileName, source)
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
