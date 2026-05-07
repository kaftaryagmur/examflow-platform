$ErrorActionPreference = "Stop"

function Replace-Once {
    param (
        [string]$Content,
        [string]$Pattern,
        [string]$Replacement,
        [string]$Label
    )

    $regex = [System.Text.RegularExpressions.Regex]::new(
        $Pattern,
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    $newContent = $regex.Replace($Content, $Replacement, 1)

    if ($newContent -eq $Content) {
        Write-Warning "No change applied for: $Label"
    } else {
        Write-Host "Updated: $Label"
    }

    return $newContent
}

function Save-File {
    param (
        [string]$Path,
        [string]$Content
    )

    Set-Content -Path $Path -Value $Content -NoNewline
}

# ---------------------------
# api-service
# ---------------------------

$apiPath = "services\api-service\cmd\main.go"
$api = Get-Content $apiPath -Raw

if ($api -notmatch 'type Event struct \{\s*EventID') {
    $api = Replace-Once $api 'type Event struct \{\s*EventType\s+string `json:"eventType"`' @'
type Event struct {
	EventID   string `json:"eventId,omitempty"`
	EventType string `json:"eventType"`
'@ "api-service Event.EventID field"
}

$api = Replace-Once $api 'return Event\{\s*EventType:\s+"document\.uploaded",' @'
return Event{
		EventID:   fmt.Sprintf("upload-%s-%d", strings.TrimSpace(req.DocumentID), time.Now().UTC().UnixNano()),
		EventType: "document.uploaded",
'@ "api-service buildEvent creates eventId"

$api = $api.Replace(
    'logKV("error", "api-service", "document persistence failed", "endpoint", "/publish", "document_id", event.DocumentID, "user_id", event.UserID, "error", err.Error())',
    'logKV("error", "api-service", "document persistence failed", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "user_id", event.UserID, "error", err.Error())'
)

$api = $api.Replace(
    'logKV("error", "api-service", "event marshal failed", "endpoint", "/publish", "error", err.Error())',
    'logKV("error", "api-service", "event marshal failed", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())'
)

$api = $api.Replace(
    'logKV("info", "api-service", "mock event published", "endpoint", "/publish", "payload", string(payload))',
    'logKV("info", "api-service", "mock event published", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "payload", string(payload))'
)

$api = $api.Replace(
    'logKV("info", "api-service", "publishing event", "endpoint", "/publish", "document_id", event.DocumentID, "event_type", event.EventType)',
    'logKV("info", "api-service", "publishing event", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "event_type", event.EventType)'
)

$api = $api.Replace(
    'logKV("error", "api-service", "publish failed", "endpoint", "/publish", "document_id", event.DocumentID, "error", err.Error())',
    'logKV("error", "api-service", "publish failed", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())'
)

$api = $api.Replace(
    'logKV("info", "api-service", "event published", "endpoint", "/publish", "document_id", event.DocumentID, "message_id", messageID)',
    'logKV("info", "api-service", "event published", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "message_id", messageID)'
)

Save-File $apiPath $api

# ---------------------------
# worker-service
# ---------------------------

$workerPath = "services\worker-service\cmd\main.go"
$worker = Get-Content $workerPath -Raw

if ($worker -notmatch 'type Event struct \{\s*EventID') {
    $worker = Replace-Once $worker 'type Event struct \{\s*EventType\s+string `json:"eventType"`' @'
type Event struct {
	EventID   string `json:"eventId,omitempty"`
	EventType string `json:"eventType"`
'@ "worker-service Event.EventID field"
}

if ($worker -notmatch 'type ProcessingResult struct \{\s*EventID') {
    $worker = Replace-Once $worker 'type ProcessingResult struct \{\s*DocumentID\s+string `json:"documentId"`' @'
type ProcessingResult struct {
	EventID    string `json:"eventId,omitempty"`
	DocumentID string `json:"documentId"`
'@ "worker-service ProcessingResult.EventID field"
}

$worker = Replace-Once $worker 'err := json\.Unmarshal\(data, &event\)\s*if err != nil \{\s*return Event\{\}, err\s*\}\s*return event, nil' @'
err := json.Unmarshal(data, &event)
	if err != nil {
		return Event{}, err
	}

	event.EventID = strings.TrimSpace(event.EventID)
	event.EventType = strings.TrimSpace(event.EventType)
	event.UserID = strings.TrimSpace(event.UserID)
	event.DocumentID = strings.TrimSpace(event.DocumentID)
	event.FileName = strings.TrimSpace(event.FileName)
	event.Source = strings.TrimSpace(event.Source)

	if event.EventID == "" {
		event.EventID = fmt.Sprintf("upload-%s-%d", event.DocumentID, time.Now().UTC().UnixNano())
	}

	return event, nil
'@ "worker-service parseEvent normalizes and backfills eventId"

$worker = Replace-Once $worker 'return ProcessingResult\{\s*DocumentID:\s+event\.DocumentID,' @'
return ProcessingResult{
		EventID:    event.EventID,
		DocumentID: event.DocumentID,
'@ "worker-service processEvent carries eventId"

$worker = Replace-Once $worker 'func buildProcessedEvent\(result ProcessingResult\) ProcessedEvent \{\s*now := time\.Now\(\)\.UTC\(\)\s*return ProcessedEvent\{\s*EventID:\s+fmt\.Sprintf\("processing-%s-%d", result\.DocumentID, now\.UnixNano\(\)\),' @'
func buildProcessedEvent(result ProcessingResult) ProcessedEvent {
	now := time.Now().UTC()
	eventID := strings.TrimSpace(result.EventID)
	if eventID == "" {
		eventID = fmt.Sprintf("processing-%s-%d", result.DocumentID, now.UnixNano())
	}

	return ProcessedEvent{
		EventID:        eventID,
'@ "worker-service buildProcessedEvent preserves eventId"

$worker = $worker.Replace(
    'logKV("info", "worker-service", "processing started", "document_id", event.DocumentID, "event_type", event.EventType, "source", event.Source)',
    'logKV("info", "worker-service", "processing started", "event_id", event.EventID, "document_id", event.DocumentID, "event_type", event.EventType, "source", event.Source)'
)

$worker = $worker.Replace(
    '"info", "worker-service", "processing completed",
			"document_id", event.DocumentID,',
    '"info", "worker-service", "processing completed",
			"event_id", event.EventID,
			"document_id", event.DocumentID,'
)

$worker = $worker.Replace(
    '"info", "worker-service", "event ignored",
				"message_id", msg.ID,
				"event_type", event.EventType,
				"document_id", event.DocumentID,',
    '"info", "worker-service", "event ignored",
				"message_id", msg.ID,
				"event_id", event.EventID,
				"event_type", event.EventType,
				"document_id", event.DocumentID,'
)

$worker = $worker.Replace(
    '"error", "worker-service", "processed event publish failed",
				"document_id", result.DocumentID,',
    '"error", "worker-service", "processed event publish failed",
				"event_id", result.EventID,
				"document_id", result.DocumentID,'
)

$worker = $worker.Replace(
    '"warn", "worker-service", "processed event publisher unavailable",
			"document_id", result.DocumentID,',
    '"warn", "worker-service", "processed event publisher unavailable",
			"event_id", result.EventID,
			"document_id", result.DocumentID,'
)

Save-File $workerPath $worker

# ---------------------------
# validation-service
# ---------------------------

$validationPath = "services\validation-service\cmd\main.go"
$validation = Get-Content $validationPath -Raw

if ($validation -notmatch 'type processedEvent struct \{\s*EventID') {
    $validation = Replace-Once $validation 'type processedEvent struct \{\s*DocumentID\s+string `json:"documentId"`' @'
type processedEvent struct {
	EventID    string `json:"eventId,omitempty"`
	DocumentID string `json:"documentId"`
'@ "validation-service processedEvent.EventID field"
}

if ($validation -notmatch 'type validationResult struct \{\s*EventID') {
    $validation = Replace-Once $validation 'type validationResult struct \{\s*DocumentID\s+string' @'
type validationResult struct {
	EventID    string
	DocumentID string
'@ "validation-service validationResult.EventID field"
}

$validation = $validation.Replace(
    'event.DocumentID = strings.TrimSpace(event.DocumentID)',
    'event.EventID = strings.TrimSpace(event.EventID)
	event.DocumentID = strings.TrimSpace(event.DocumentID)'
)

$validation = Replace-Once $validation 'return validationResult\{\s*DocumentID:\s+event\.DocumentID,' @'
return validationResult{
		EventID:    event.EventID,
		DocumentID: event.DocumentID,
'@ "validation-service validateDocument carries eventId"

$validation = Replace-Once $validation 'func buildValidatedEvent\(result validationResult\) validatedEvent \{\s*eventTimestamp := time\.Now\(\)\.UTC\(\)\.Format\(time\.RFC3339\)\s*return validatedEvent\{\s*EventID:\s+fmt\.Sprintf\("validation-%s-%d", result\.DocumentID, time\.Now\(\)\.UTC\(\)\.UnixNano\(\)\),' @'
func buildValidatedEvent(result validationResult) validatedEvent {
	eventTimestamp := time.Now().UTC().Format(time.RFC3339)
	eventID := strings.TrimSpace(result.EventID)
	if eventID == "" {
		eventID = fmt.Sprintf("validation-%s-%d", result.DocumentID, time.Now().UTC().UnixNano())
	}

	return validatedEvent{
		EventID:          eventID,
'@ "validation-service buildValidatedEvent preserves eventId"

$validation = $validation.Replace(
    '"info", "validation-service", "document.processed received",
			"message_id", msg.ID,
			"document_id", event.DocumentID,',
    '"info", "validation-service", "document.processed received",
			"message_id", msg.ID,
			"event_id", event.EventID,
			"document_id", event.DocumentID,'
)

$validation = $validation.Replace(
    'logKV("info", "validation-service", "validation completed", "validation_result", result.Status, "document_id", result.DocumentID)',
    'logKV("info", "validation-service", "validation completed", "event_id", result.EventID, "validation_result", result.Status, "document_id", result.DocumentID)'
)

$validation = $validation.Replace(
    'logKV("error", "validation-service", "validated event publish failed", "document_id", result.DocumentID, "error", err.Error())',
    'logKV("error", "validation-service", "validated event publish failed", "event_id", result.EventID, "document_id", result.DocumentID, "error", err.Error())'
)

$validation = $validation.Replace(
    'logKV("warn", "validation-service", "validated event publisher unavailable", "document_id", result.DocumentID)',
    'logKV("warn", "validation-service", "validated event publisher unavailable", "event_id", result.EventID, "document_id", result.DocumentID)'
)

Save-File $validationPath $validation

# ---------------------------
# exam-service
# ---------------------------

$examPath = "services\exam-service\cmd\main.go"
$exam = Get-Content $examPath -Raw

$exam = $exam.Replace(
    '"info", "exam-service", "validation result received",
		"message_id", msg.ID(),
		"document_id", event.DocumentID,',
    '"info", "exam-service", "validation result received",
		"message_id", msg.ID(),
		"event_id", event.EventID,
		"document_id", event.DocumentID,'
)

$exam = $exam.Replace(
    'logKV("warn", "exam-service", "unexpected event type", "message_id", msg.ID(), "event_type", event.EventType)',
    'logKV("warn", "exam-service", "unexpected event type", "message_id", msg.ID(), "event_id", event.EventID, "event_type", event.EventType)'
)

$exam = $exam.Replace(
    'logKV("error", "exam-service", "exam lifecycle transition failed", "message_id", msg.ID(), "document_id", event.DocumentID, "error", err.Error())',
    'logKV("error", "exam-service", "exam lifecycle transition failed", "message_id", msg.ID(), "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())'
)

$exam = $exam.Replace(
    'logKV("error", "exam-service", "exam persistence failed", "message_id", msg.ID(), "document_id", exam.DocumentID, "error", err.Error())',
    'logKV("error", "exam-service", "exam persistence failed", "message_id", msg.ID(), "event_id", event.EventID, "document_id", exam.DocumentID, "error", err.Error())'
)

$exam = $exam.Replace(
    '"info", "exam-service", "exam state updated",
		"document_id", exam.DocumentID,',
    '"info", "exam-service", "exam state updated",
		"event_id", event.EventID,
		"document_id", exam.DocumentID,'
)

Save-File $examPath $exam

# ---------------------------
# tests
# ---------------------------

Add-Content "services\api-service\cmd\main_test.go" @'

func TestBuildEventAddsEventID(t *testing.T) {
	event := buildEvent(PublishRequest{
		DocumentID: "doc-69",
		FileName:   "observability.pdf",
		Source:     "test",
	}, "user-69")

	if event.EventID == "" {
		t.Fatal("expected eventId to be populated")
	}
	if event.DocumentID != "doc-69" {
		t.Fatalf("expected documentId doc-69, got %q", event.DocumentID)
	}
}
'@

Add-Content "services\worker-service\cmd\main_test.go" @'

func TestBuildProcessedEventPreservesEventID(t *testing.T) {
	event := buildProcessedEvent(ProcessingResult{
		EventID:        "evt-trace-69",
		DocumentID:     "doc-69",
		UserID:         "user-69",
		Status:         "processed",
		SummaryPreview: "Processed document doc-69",
		ProcessedAt:    "2026-05-07T19:30:00Z",
	})

	if event.EventID != "evt-trace-69" {
		t.Fatalf("expected eventId to be preserved, got %q", event.EventID)
	}
	if event.DocumentID != "doc-69" {
		t.Fatalf("expected documentId doc-69, got %q", event.DocumentID)
	}
}
'@

Add-Content "services\validation-service\cmd\main_test.go" @'

func TestBuildValidatedEventPreservesEventID(t *testing.T) {
	event := buildValidatedEvent(validationResult{
		EventID:    "evt-trace-69",
		DocumentID: "doc-69",
		UserID:     "user-69",
		Status:     "valid",
	})

	if event.EventID != "evt-trace-69" {
		t.Fatalf("expected eventId to be preserved, got %q", event.EventID)
	}
	if event.DocumentID != "doc-69" {
		t.Fatalf("expected documentId doc-69, got %q", event.DocumentID)
	}
}
'@

Add-Content "services\exam-service\cmd\main_test.go" @'

func TestParseValidatedEventReturnsEventID(t *testing.T) {
	event, err := parseValidatedEvent([]byte(`{"eventId":"evt-trace-69","documentId":"doc-69","userId":"64b7f8f8f8f8f8f8f8f8f8f8","eventType":"exam.validation.completed","validationResult":"valid","timestamp":"2026-05-07T19:30:00Z"}`))
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if event.EventID != "evt-trace-69" {
		t.Fatalf("expected eventId to be parsed, got %q", event.EventID)
	}
	if event.DocumentID != "doc-69" {
		t.Fatalf("expected documentId doc-69, got %q", event.DocumentID)
	}
}
'@

# ---------------------------
# docs
# ---------------------------

@'
# Event ID and Document ID Logging

## Goal

SCRUM-69 makes event and document identifiers visible in service logs.

The same event_id is propagated through the main asynchronous flow:

api-service -> worker-service -> validation-service -> exam-service

## Fields

Relevant application logs include:

- event_id
- document_id
- event_type
- message_id
- service
- message

## Flow

1. api-service creates an eventId when a document upload event is created.
2. worker-service reads the incoming eventId and includes it in processing logs.
3. worker-service publishes document.processed with the same eventId.
4. validation-service reads the same eventId and includes it in validation logs.
5. validation-service publishes exam.validation.completed with the same eventId.
6. exam-service reads the same eventId and includes it in exam lifecycle logs.

## Example

```json
{
  "timestamp": "2026-05-07T19:30:00Z",
  "level": "INFO",
  "service": "validation-service",
  "message": "validation completed",
  "event_id": "upload-doc-69-123456789",
  "document_id": "doc-69",
  "validation_result": "valid"
}
'@ | Set-Content docs\event-id-document-id-logging.md

Write-Host "SCRUM-69 event_id/document_id propagation update completed."