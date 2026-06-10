package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cloud.google.com/go/pubsub"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
)

func init() {
	log.SetFlags(0)
}

type healthResponse struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Timestamp string `json:"timestamp"`
}

type validatedEvent struct {
	EventID          string `json:"eventId,omitempty"`
	DocumentID       string `json:"documentId"`
	UserID           string `json:"userId"`
	EventType        string `json:"eventType"`
	ValidationResult string `json:"validationResult"`
	Timestamp        string `json:"timestamp"`
}

type eventEnvelope struct {
	EventID    string `json:"eventId,omitempty"`
	DocumentID string `json:"documentId,omitempty"`
	EventType  string `json:"eventType"`
}

type examMessage interface {
	ID() string
	Data() []byte
	Ack()
	Nack()
}

type pubsubMessage struct {
	msg *pubsub.Message
}

type mongoDBConfig struct {
	URI      string
	Database string
}

type examStore interface {
	Save(context.Context, Exam) error
}

type noopExamStore struct{}

type mongoExamStore struct {
	collection *mongo.Collection
}

// documentReader fetches the persisted document record so the generator has
// real metadata (file name, source) to work from.
type documentReader interface {
	FindByDocumentID(ctx context.Context, userID, documentID string) (Document, error)
}

type mongoDocumentReader struct {
	collection *mongo.Collection
}

// documentFileReader downloads the raw uploaded document (PDF/DOCX) from GridFS
// so the generator can work from the real content, not just metadata.
type documentFileReader interface {
	DownloadFile(ctx context.Context, fileID bson.ObjectID, max int64) ([]byte, error)
}

type mongoDocumentFileReader struct {
	bucket *mongo.GridFSBucket
}

var (
	exams     examStore = noopExamStore{}
	documents documentReader
	files     documentFileReader
	generator questionGenerator
)

func (m pubsubMessage) ID() string   { return m.msg.ID }
func (m pubsubMessage) Data() []byte { return m.msg.Data }
func (m pubsubMessage) Ack()         { m.msg.Ack() }
func (m pubsubMessage) Nack()        { m.msg.Nack() }

func main() {
	port := os.Getenv("PORT")
	projectID := os.Getenv("GCP_PROJECT_ID")
	subscriptionID := os.Getenv("PUBSUB_EXAM_SUBSCRIPTION")
	if port == "" {
		port = "8080"
	}

	shutdownTracing, err := initTracing(context.Background(), "exam-service")
	if err != nil {
		logKV("warn", "exam-service", "tracing init failed", "error", err.Error())
	} else {
		defer func() { _ = shutdownTracing(context.Background()) }()
	}

	mongoClient, mongoDatabase, err := connectMongoDB(context.Background())
	if err != nil {
		logKV("warn", "exam-service", "mongodb connection unavailable", "error", err.Error())
	} else if mongoClient != nil {
		defer mongoClient.Disconnect(context.Background())
		exams = mongoExamStore{collection: mongoDatabase.Collection(examsCollection)}
		documents = mongoDocumentReader{collection: mongoDatabase.Collection(documentsCollection)}
		files = mongoDocumentFileReader{bucket: mongoDatabase.GridFSBucket()}
		activity = mongoActivityRecorder{collection: mongoDatabase.Collection(activityEventsCollection)}
		logKV("info", "exam-service", "mongodb connection ready", "database", mongoDatabase.Name())
	}

	if apiKey := strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")); apiKey != "" {
		generator = newClaudeQuestionGenerator(apiKey, os.Getenv("ANTHROPIC_MODEL"), os.Getenv("ANTHROPIC_BASE_URL"))
		logKV("info", "exam-service", "ai question generation enabled", "model", generator.Model())
	} else {
		logKV("info", "exam-service", "anthropic api key not configured, ai question generation disabled")
	}

	handler := newServer()
	go startConsumer(context.Background(), projectID, subscriptionID)

	logKV("info", "exam-service", "listening", "port", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		logKV("error", "exam-service", "http server stopped", "error", err.Error())
		os.Exit(1)
	}
}

func newServer() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		writeJSON(w, http.StatusOK, healthResponse{
			Status:    "ok",
			Service:   "exam-service",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		})
	})

	return mux
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func startConsumer(ctx context.Context, projectID, subscriptionID string) {
	if projectID == "" || subscriptionID == "" {
		logKV("info", "exam-service", "missing pubsub configuration, consumer disabled")
		return
	}

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		logKV("error", "exam-service", "pubsub client error", "error", err.Error())
		return
	}
	defer client.Close()

	sub := client.Subscription(subscriptionID)
	logKV("info", "exam-service", "listening for messages", "subscription", subscriptionID)

	err = sub.Receive(ctx, func(ctx context.Context, msg *pubsub.Message) {
		// Gelen mesajdaki trace context'i çıkar (validation inject ettiyse zincir birleşir).
		msgCtx := otel.GetTextMapPropagator().Extract(ctx, pubsubAttributesCarrier(msg.Attributes))
		_, span := otel.Tracer("exam-service").Start(msgCtx, "process validation event")
		span.SetAttributes(attribute.String("messaging.message.id", msg.ID))
		defer span.End()
		handleValidatedMessage(pubsubMessage{msg: msg})
	})
	if err != nil {
		logKV("error", "exam-service", "receive error", "error", err.Error())
	}
}

func handleValidatedMessage(msg examMessage) {
	envelope, err := parseEventEnvelope(msg.Data())
	if err != nil {
		logKV("error", "exam-service", "message envelope parse failed", "message_id", msg.ID(), "error", err.Error())
		msg.Nack()
		return
	}

	if envelope.EventType != "exam.validation.completed" {
		logKV(
			"info", "exam-service", "event ignored",
			"message_id", msg.ID(),
			"event_id", envelope.EventID,
			"document_id", envelope.DocumentID,
			"event_type", envelope.EventType,
		)
		msg.Ack()
		return
	}

	event, err := parseValidatedEvent(msg.Data())
	if err != nil {
		logKV(
			"error", "exam-service", "message parse failed",
			"message_id", msg.ID(),
			"event_id", envelope.EventID,
			"document_id", envelope.DocumentID,
			"event_type", envelope.EventType,
			"error", err.Error(),
		)
		msg.Nack()
		return
	}

	logKV(
		"info", "exam-service", "validation result received",
		"message_id", msg.ID(),
		"event_id", event.EventID,
		"document_id", event.DocumentID,
		"event_type", event.EventType,
		"validation_result", event.ValidationResult,
	)
	recordExamActivity(context.Background(), event, activityStatusProcessing, "exam.processing", "Exam Service validation sonucunu aldi ve sinav kaydini hazirliyor.", "")

	exam, err := buildExam(event)
	if err != nil {
		logKV("error", "exam-service", "exam lifecycle transition failed", "message_id", msg.ID(), "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())
		recordExamActivity(context.Background(), event, activityStatusFailed, "exam.lifecycle.failed", "Sinav yasam dongusu guncellenemedi.", err.Error())
		msg.Nack()
		return
	}

	if exam.Status == examStatusValidated {
		enrichExamWithGeneratedContent(&exam, event)
	}

	if err := exams.Save(context.Background(), exam); err != nil {
		logKV("error", "exam-service", "exam persistence failed", "message_id", msg.ID(), "event_id", event.EventID, "document_id", exam.DocumentID, "error", err.Error())
		recordExamActivity(context.Background(), event, activityStatusFailed, "exam.persistence.failed", "Sinav kaydi MongoDB'ye yazilamadi.", err.Error())
		msg.Nack()
		return
	}
	if exam.Status == examStatusFailed {
		recordExamActivity(context.Background(), event, activityStatusFailed, "exam.validation.failed", "Validation sonucu basarisiz oldugu icin sinav failed olarak kaydedildi.", exam.ValidationResult)
	} else {
		recordExamActivity(context.Background(), event, activityStatusValidated, "exam.validated", "Sinav kaydi olusturuldu ve goruntulenebilir hale geldi.", "")
	}

	logKV(
		"info", "exam-service", "exam state updated",
		"event_id", event.EventID,
		"document_id", exam.DocumentID,
		"validation_result", exam.ValidationResult,
		"state", exam.Status,
		"created_at", exam.CreatedAt,
	)
	msg.Ack()
}

func (noopExamStore) Save(context.Context, Exam) error {
	return nil
}

func (store mongoExamStore) Save(ctx context.Context, exam Exam) error {
	saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if exam.ID.IsZero() {
		exam.ID = bson.NewObjectID()
	}

	_, err := store.collection.InsertOne(saveCtx, exam)
	if err != nil {
		return err
	}
	logKV("info", "exam-service", "exam persisted to mongodb", "document_id", exam.DocumentID, "collection", store.collection.Name())
	return nil
}

func (r mongoDocumentReader) FindByDocumentID(ctx context.Context, userID, documentID string) (Document, error) {
	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	filter := bson.M{"documentId": strings.TrimSpace(documentID)}
	if uid := strings.TrimSpace(userID); uid != "" {
		objectID, err := bson.ObjectIDFromHex(uid)
		if err != nil {
			return Document{}, fmt.Errorf("invalid userId %q", userID)
		}
		filter["userId"] = objectID
	}

	var document Document
	if err := r.collection.FindOne(findCtx, filter).Decode(&document); err != nil {
		return Document{}, err
	}
	return document, nil
}

func (r mongoDocumentFileReader) DownloadFile(ctx context.Context, fileID bson.ObjectID, max int64) ([]byte, error) {
	downloadCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	stream, err := r.bucket.OpenDownloadStream(downloadCtx, fileID)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	return io.ReadAll(io.LimitReader(stream, max))
}

// enrichExamWithGeneratedContent generates questions/info cards for a validated
// exam. Generation is best-effort: any failure is logged and the exam is still
// persisted (without questions) so the event pipeline is never blocked.
func enrichExamWithGeneratedContent(exam *Exam, event validatedEvent) {
	if generator == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	input := GenerationInput{DocumentID: event.DocumentID}
	if documents != nil {
		doc, err := documents.FindByDocumentID(ctx, event.UserID, event.DocumentID)
		if err != nil {
			logKV("warn", "exam-service", "document metadata lookup failed for generation", "document_id", event.DocumentID, "error", err.Error())
		} else {
			input.FileName = doc.FileName
			exam.Title = buildExamTitle(doc.FileName, event.DocumentID)
			input.Source = doc.Source
			input.ContentType = doc.ContentType
			input.Prefs = doc.GenerationPrefs
			// Pull the real document content from GridFS so generation is based on
			// the document itself, not just its file name. Best-effort: on failure
			// the generator falls back to metadata.
			if files != nil && !doc.FileID.IsZero() {
				data, err := files.DownloadFile(ctx, doc.FileID, maxDocumentBytes+1)
				if err != nil {
					logKV("warn", "exam-service", "document file download failed, falling back to metadata", "document_id", event.DocumentID, "file_id", doc.FileID.Hex(), "error", err.Error())
				} else {
					input.FileContent = data
				}
			}
		}
	}

	content, err := generator.Generate(ctx, input)
	if err != nil {
		logKV("warn", "exam-service", "exam content generation failed, persisting without questions", "document_id", event.DocumentID, "error", err.Error())
		recordExamActivity(context.Background(), event, activityStatusFailed, "exam.generation.failed", "AI soru ve bilgi karti uretimi basarisiz oldu; sinav kaydi bos icerikle saklanacak.", err.Error())
		return
	}

	prefs := resolveGenerationPrefs(input.Prefs)
	qualityStatus, qualityIssues := evaluateExamQuality(content, prefs)

	exam.Questions = content.Questions
	exam.InfoCards = content.InfoCards
	exam.GenerationModel = generator.Model()
	exam.GenerationPrefs = prefs
	exam.QualityStatus = qualityStatus
	exam.QualityIssues = qualityIssues
	logKV(
		"info", "exam-service", "exam content generated",
		"document_id", event.DocumentID,
		"question_count", len(content.Questions),
		"info_card_count", len(content.InfoCards),
		"used_document_content", len(input.FileContent) > 0,
		"requested_question_count", prefs.QuestionCount,
		"difficulty", prefs.Difficulty,
		"quality_status", qualityStatus,
		"quality_issue_count", len(qualityIssues),
		"model", generator.Model(),
	)
	recordExamActivity(context.Background(), event, activityStatusValidated, "exam.generated", "AI soru ve bilgi kartlari uretildi.", "")
}

func parseEventEnvelope(data []byte) (eventEnvelope, error) {
	var event eventEnvelope
	if err := json.Unmarshal(data, &event); err != nil {
		return eventEnvelope{}, err
	}

	event.EventID = strings.TrimSpace(event.EventID)
	event.DocumentID = strings.TrimSpace(event.DocumentID)
	event.EventType = strings.TrimSpace(event.EventType)

	if event.EventType == "" {
		return eventEnvelope{}, fmt.Errorf("eventType is required")
	}

	return event, nil
}

func parseValidatedEvent(data []byte) (validatedEvent, error) {
	var event validatedEvent
	if err := json.Unmarshal(data, &event); err != nil {
		return validatedEvent{}, err
	}

	event.EventID = strings.TrimSpace(event.EventID)
	event.DocumentID = strings.TrimSpace(event.DocumentID)
	event.UserID = strings.TrimSpace(event.UserID)
	event.EventType = strings.TrimSpace(event.EventType)
	event.ValidationResult = strings.TrimSpace(event.ValidationResult)
	event.Timestamp = strings.TrimSpace(event.Timestamp)

	if event.EventType == "" {
		return validatedEvent{}, fmt.Errorf("eventType is required")
	}
	if event.ValidationResult == "" {
		return validatedEvent{}, fmt.Errorf("validationResult is required")
	}

	return event, nil
}

func buildExam(event validatedEvent) (Exam, error) {
	status, err := resolveExamLifecycleStatus(event.ValidationResult)
	if err != nil {
		return Exam{}, err
	}

	exam := Exam{
		ID:               bson.NewObjectID(),
		DocumentID:       event.DocumentID,
		Title:            buildExamTitle("", event.DocumentID),
		ValidationResult: event.ValidationResult,
		Status:           status,
		CreatedAt:        time.Now().UTC().Format(time.RFC3339),
	}
	if event.UserID != "" {
		userID, err := bson.ObjectIDFromHex(event.UserID)
		if err != nil {
			return Exam{}, fmt.Errorf("invalid userId %q", event.UserID)
		}
		exam.UserID = userID
	}

	return exam, nil
}

func buildExamTitle(fileName string, documentID string) string {
	base := strings.TrimSpace(fileName)
	if base != "" {
		base = strings.TrimSuffix(base, filepath.Ext(base))
	}
	if base == "" {
		base = strings.TrimSpace(documentID)
	}
	if base == "" {
		return "Olusturulan sinav"
	}
	return base + " sinavi"
}

func loadMongoDBConfig() (mongoDBConfig, bool) {
	uri := strings.TrimSpace(os.Getenv("MONGODB_URI"))
	if uri == "" {
		return mongoDBConfig{}, false
	}

	database := strings.TrimSpace(os.Getenv("MONGODB_DATABASE"))
	if database == "" {
		database = "examflow"
	}

	return mongoDBConfig{
		URI:      uri,
		Database: database,
	}, true
}

func connectMongoDB(ctx context.Context) (*mongo.Client, *mongo.Database, error) {
	config, ok := loadMongoDBConfig()
	if !ok {
		return nil, nil, nil
	}

	client, err := mongo.Connect(options.Client().ApplyURI(config.URI))
	if err != nil {
		return nil, nil, err
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, nil, err
	}

	return client, client.Database(config.Database), nil
}

func resolveExamLifecycleStatus(validationResult string) (string, error) {
	status, err := transitionExamStatus(examStatusDraft, examStatusProcessing)
	if err != nil {
		return "", err
	}

	switch strings.ToLower(strings.TrimSpace(validationResult)) {
	case "valid", "passed":
		return transitionExamStatus(status, examStatusValidated)
	case "invalid", "failed":
		return transitionExamStatus(status, examStatusFailed)
	default:
		return "", fmt.Errorf("unsupported validationResult %q", validationResult)
	}
}

func resolveExamStatus(validationResult string) string {
	switch strings.ToLower(strings.TrimSpace(validationResult)) {
	case "valid", "passed":
		return examStatusReady
	case "invalid", "failed":
		return examStatusFailed
	default:
		return examStatusCreated
	}
}

func transitionExamStatus(current, next string) (string, error) {
	allowed, ok := validExamTransitions[current]
	if !ok {
		return "", fmt.Errorf("unknown exam status %q", current)
	}
	if !allowed[next] {
		return "", fmt.Errorf("invalid exam status transition %q -> %q", current, next)
	}
	return next, nil
}

func logKV(level, service, msg string, keyvals ...any) {
	fields := map[string]any{
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"level":     strings.ToUpper(level),
		"service":   service,
		"message":   msg,
	}

	for i := 0; i+1 < len(keyvals); i += 2 {
		key := strings.TrimSpace(fmt.Sprint(keyvals[i]))
		if key == "" {
			continue
		}
		fields[key] = keyvals[i+1]
	}

	encoded, err := json.Marshal(fields)
	if err != nil {
		log.Printf(`{"timestamp":%q,"level":"ERROR","service":%q,"message":"log serialization failed","error":%q}`, time.Now().UTC().Format(time.RFC3339), service, err.Error())
		return
	}

	log.Println(string(encoded))
}
