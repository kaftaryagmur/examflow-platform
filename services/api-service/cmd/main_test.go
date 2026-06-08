package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"cloud.google.com/go/pubsub"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/crypto/bcrypt"
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

type fakeUserStore struct {
	users map[string]User
	err   error
}

type fakeDocumentStore struct {
	documents []Document
	err       error
}

type fakeFileStore struct {
	files       map[bson.ObjectID][]byte
	err         error
	openErr     error
	lastRequest PublishRequest
	lastUserID  string
}

type fakeExamStore struct {
	exams []Exam
	err   error
}

type fakeActivityStore struct {
	activities []ActivityEvent
	err        error
}

var testAuth = authService{
	secret: []byte("test-jwt-secret-with-enough-length"),
	ttl:    time.Hour,
	now: func() time.Time {
		return time.Date(2026, 5, 7, 12, 0, 0, 0, time.UTC)
	},
}

func testBearerToken(t *testing.T) string {
	t.Helper()
	user := User{
		ID:          bson.NewObjectID(),
		Email:       "teacher@example.com",
		DisplayName: "Teacher User",
		Status:      userStatusActive,
	}
	token, err := testAuth.GenerateToken(user)
	if err != nil {
		t.Fatalf("token generation failed: %v", err)
	}
	return token
}

func testBearerTokenForUser(t *testing.T, user User) string {
	t.Helper()
	token, err := testAuth.GenerateToken(user)
	if err != nil {
		t.Fatalf("token generation failed: %v", err)
	}
	return token
}

func multipartPublishBody(t *testing.T, fields map[string]string, fileName string, content []byte) (*bytes.Buffer, string) {
	t.Helper()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("write field failed: %v", err)
		}
	}

	if fileName != "" {
		part, err := writer.CreateFormFile(publishFileFieldName, fileName)
		if err != nil {
			t.Fatalf("create file part failed: %v", err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatalf("write file content failed: %v", err)
		}
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer failed: %v", err)
	}

	return body, writer.FormDataContentType()
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

func (f *fakeUserStore) CreateUser(_ context.Context, user User) (User, error) {
	if f.err != nil {
		return User{}, f.err
	}
	if f.users == nil {
		f.users = map[string]User{}
	}
	if _, ok := f.users[user.Email]; ok {
		return User{}, errUserAlreadyExists
	}
	if user.Role == "" {
		user.Role = userRoleUser
	}
	f.users[user.Email] = user
	return user, nil
}

func (f *fakeUserStore) FindUserByEmail(_ context.Context, email string) (User, error) {
	if f.err != nil {
		return User{}, f.err
	}
	if f.users == nil {
		return User{}, errUserNotFound
	}
	user, ok := f.users[normalizeEmail(email)]
	if !ok {
		return User{}, errUserNotFound
	}
	return user, nil
}

func (f *fakeUserStore) FindUserByID(_ context.Context, userID string) (User, error) {
	if f.err != nil {
		return User{}, f.err
	}
	if f.users == nil {
		return User{}, errUserNotFound
	}
	for _, user := range f.users {
		if user.ID.Hex() == userID {
			return user, nil
		}
	}
	return User{}, errUserNotFound
}

func (f *fakeUserStore) UpdateUser(_ context.Context, user User) (User, error) {
	if f.err != nil {
		return User{}, f.err
	}
	if f.users == nil {
		return User{}, errUserNotFound
	}
	f.users[user.Email] = user
	return user, nil
}

func (f *fakeUserStore) ListUsers(_ context.Context) ([]User, error) {
	if f.err != nil {
		return nil, f.err
	}
	users := make([]User, 0, len(f.users))
	for _, user := range f.users {
		users = append(users, user)
	}
	return users, nil
}

func (f *fakeDocumentStore) CreateDocument(_ context.Context, document Document) (Document, error) {
	if f.err != nil {
		return Document{}, f.err
	}
	f.documents = append(f.documents, document)
	return document, nil
}

func (f *fakeDocumentStore) FindDocument(_ context.Context, userID string, documentID string) (Document, error) {
	if f.err != nil {
		return Document{}, f.err
	}
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return Document{}, err
	}
	for _, document := range f.documents {
		if document.DocumentID == documentID && document.UserID == userObjectID {
			return document, nil
		}
	}
	return Document{}, errDocumentNotFound
}

func (f *fakeDocumentStore) ListDocuments(context.Context, string) ([]Document, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.documents, nil
}

func (f *fakeFileStore) SaveDocumentFile(_ context.Context, req PublishRequest, userID string) (bson.ObjectID, error) {
	if f.err != nil {
		return bson.ObjectID{}, f.err
	}
	if f.files == nil {
		f.files = map[bson.ObjectID][]byte{}
	}
	fileID := bson.NewObjectID()
	f.files[fileID] = append([]byte(nil), req.FileContent...)
	f.lastRequest = req
	f.lastUserID = userID
	return fileID, nil
}

func (f *fakeFileStore) OpenDocumentFile(_ context.Context, fileID bson.ObjectID) (io.ReadCloser, error) {
	if f.openErr != nil {
		return nil, f.openErr
	}
	content, ok := f.files[fileID]
	if !ok {
		return nil, mongo.ErrFileNotFound
	}
	return io.NopCloser(bytes.NewReader(content)), nil
}

func (f *fakeExamStore) ListExams(context.Context, string) ([]Exam, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.exams, nil
}

func (f *fakeActivityStore) CreateActivity(_ context.Context, event ActivityEvent) error {
	if f.err != nil {
		return f.err
	}
	f.activities = append(f.activities, event)
	return nil
}

func (f *fakeActivityStore) ListActivities(_ context.Context, _ string, documentID string) ([]ActivityEvent, error) {
	if f.err != nil {
		return nil, f.err
	}
	if documentID == "" {
		return f.activities, nil
	}
	var filtered []ActivityEvent
	for _, activity := range f.activities {
		if activity.DocumentID == documentID {
			filtered = append(filtered, activity)
		}
	}
	return filtered, nil
}

func useActivityStore(t *testing.T, store activityStore) {
	t.Helper()
	previous := activities
	activities = store
	t.Cleanup(func() {
		activities = previous
	})
}

func TestPublishRequiresFile(t *testing.T) {
	body, contentType := multipartPublishBody(t, map[string]string{"documentId": "doc-42"}, "", nil)
	req := httptest.NewRequest(http.MethodPost, "/publish", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, &fakeDocumentStore{}, nil, testAuth, true, &fakeFileStore{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPublishReturnsAcceptedResponse(t *testing.T) {
	fileContent := []byte("%PDF-1.4 sample content")
	requestBody, contentType := multipartPublishBody(t, map[string]string{
		"documentId": "doc-42",
		"source":     "web",
	}, "week1.pdf", fileContent)
	req := httptest.NewRequest(http.MethodPost, "/publish", requestBody)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	fake := &fakePublisher{result: fakePublishResult{id: "msg-123"}}
	documents := &fakeDocumentStore{}
	files := &fakeFileStore{}
	activity := &fakeActivityStore{}
	useActivityStore(t, activity)
	newServer(context.Background(), fake, "pubsub", nil, nil, documents, nil, testAuth, true, files).ServeHTTP(rec, req)

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
	if !bytes.Contains(fake.lastPayload, []byte(`"fileName":"week1.pdf"`)) {
		t.Fatalf("expected payload to include fileName, got %s", string(fake.lastPayload))
	}
	if !bytes.Contains(fake.lastPayload, []byte(`"fileSize":23`)) {
		t.Fatalf("expected payload to include fileSize, got %s", string(fake.lastPayload))
	}
	if !bytes.Contains(fake.lastPayload, []byte(`"userId"`)) {
		t.Fatalf("expected payload to include userId, got %s", string(fake.lastPayload))
	}
	if len(documents.documents) != 1 {
		t.Fatalf("expected one persisted document, got %d", len(documents.documents))
	}
	if documents.documents[0].DocumentID != "doc-42" {
		t.Fatalf("expected persisted documentId doc-42, got %q", documents.documents[0].DocumentID)
	}
	if documents.documents[0].FileName != "week1.pdf" {
		t.Fatalf("expected persisted fileName week1.pdf, got %q", documents.documents[0].FileName)
	}
	if documents.documents[0].FileSize != int64(len(fileContent)) {
		t.Fatalf("expected persisted fileSize %d, got %d", len(fileContent), documents.documents[0].FileSize)
	}
	if documents.documents[0].ContentType == "" {
		t.Fatal("expected persisted contentType")
	}
	if documents.documents[0].FileID.IsZero() {
		t.Fatal("expected persisted fileId")
	}
	if documents.documents[0].StorageBackend != storageBackendGridFS {
		t.Fatalf("expected storage backend %q, got %q", storageBackendGridFS, documents.documents[0].StorageBackend)
	}
	if documents.documents[0].FileURL != "/documents/doc-42/file" {
		t.Fatalf("expected fileUrl /documents/doc-42/file, got %q", documents.documents[0].FileURL)
	}
	if !bytes.Equal(files.files[documents.documents[0].FileID], fileContent) {
		t.Fatal("expected uploaded file content to be stored")
	}
	if documents.documents[0].Status != documentStatusUploaded {
		t.Fatalf("expected uploaded status, got %q", documents.documents[0].Status)
	}
	if len(activity.activities) != 2 {
		t.Fatalf("expected received and published activity events, got %d", len(activity.activities))
	}
	if activity.activities[0].Status != activityStatusReceived {
		t.Fatalf("expected first activity status received, got %q", activity.activities[0].Status)
	}
	if activity.activities[1].Status != activityStatusPublished {
		t.Fatalf("expected second activity status published, got %q", activity.activities[1].Status)
	}
}

func TestPublishStoresGenerationPrefs(t *testing.T) {
	body, contentType := multipartPublishBody(t, map[string]string{
		"documentId":    "doc-42",
		"source":        "web",
		"questionCount": "8",
		"difficulty":    "hard",
		"infoCardCount": "4",
		"focus":         "  hücre bölünmesi  ",
	}, "week1.pdf", []byte("%PDF-1.4 sample content"))
	req := httptest.NewRequest(http.MethodPost, "/publish", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	documents := &fakeDocumentStore{}
	newServer(context.Background(), nil, "mock", nil, nil, documents, nil, testAuth, true, &fakeFileStore{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(documents.documents) != 1 {
		t.Fatalf("expected one persisted document, got %d", len(documents.documents))
	}
	prefs := documents.documents[0].GenerationPrefs
	if prefs.QuestionCount != 8 {
		t.Fatalf("expected questionCount 8, got %d", prefs.QuestionCount)
	}
	if prefs.Difficulty != "hard" {
		t.Fatalf("expected difficulty hard, got %q", prefs.Difficulty)
	}
	if prefs.InfoCardCount != 4 {
		t.Fatalf("expected infoCardCount 4, got %d", prefs.InfoCardCount)
	}
	if prefs.Focus != "hücre bölünmesi" {
		t.Fatalf("expected trimmed focus, got %q", prefs.Focus)
	}
}

func TestPublishClampsAndDefaultsGenerationPrefs(t *testing.T) {
	body, contentType := multipartPublishBody(t, map[string]string{
		"documentId":    "doc-42",
		"source":        "web",
		"questionCount": "999",
		"difficulty":    "impossible",
	}, "week1.pdf", []byte("%PDF-1.4 sample content"))
	req := httptest.NewRequest(http.MethodPost, "/publish", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	documents := &fakeDocumentStore{}
	newServer(context.Background(), nil, "mock", nil, nil, documents, nil, testAuth, true, &fakeFileStore{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	prefs := documents.documents[0].GenerationPrefs
	if prefs.QuestionCount != maxQuestionCount {
		t.Fatalf("expected questionCount clamped to %d, got %d", maxQuestionCount, prefs.QuestionCount)
	}
	if prefs.Difficulty != difficultyMixed {
		t.Fatalf("expected invalid difficulty to default to mixed, got %q", prefs.Difficulty)
	}
	if prefs.InfoCardCount != defaultInfoCardCount {
		t.Fatalf("expected default infoCardCount %d, got %d", defaultInfoCardCount, prefs.InfoCardCount)
	}
}

func TestPublishRequiresBearerToken(t *testing.T) {
	body, contentType := multipartPublishBody(t, map[string]string{"documentId": "doc-42", "source": "web"}, "week1.pdf", []byte("%PDF-1.4 sample content"))
	req := httptest.NewRequest(http.MethodPost, "/publish", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, &fakeDocumentStore{}, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestPublishRequiresDocumentStore(t *testing.T) {
	body, contentType := multipartPublishBody(t, map[string]string{"documentId": "doc-42", "source": "web"}, "week1.pdf", []byte("%PDF-1.4 sample content"))
	req := httptest.NewRequest(http.MethodPost, "/publish", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestPublishReturnsErrorWhenDocumentPersistenceFails(t *testing.T) {
	body, contentType := multipartPublishBody(t, map[string]string{"documentId": "doc-42", "source": "web"}, "week1.pdf", []byte("%PDF-1.4 sample content"))
	req := httptest.NewRequest(http.MethodPost, "/publish", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	documents := &fakeDocumentStore{err: errors.New("insert failed")}
	newServer(context.Background(), nil, "mock", nil, nil, documents, nil, testAuth, true, &fakeFileStore{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
}

func TestPublishRejectsJSONBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/publish", bytes.NewBufferString(`{"documentId":"doc-42","fileName":"week1.pdf","source":"web"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, &fakeDocumentStore{}, nil, testAuth, true, &fakeFileStore{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPublishRejectsUnsupportedFileExtension(t *testing.T) {
	body, contentType := multipartPublishBody(t, map[string]string{"documentId": "doc-42", "source": "web"}, "notes.txt", []byte("plain text"))
	req := httptest.NewRequest(http.MethodPost, "/publish", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, &fakeDocumentStore{}, nil, testAuth, true, &fakeFileStore{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestListDocumentsReturnsPersistedRecords(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/documents", nil)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	documents := &fakeDocumentStore{documents: []Document{
		{
			ID:         bson.NewObjectID(),
			UserID:     bson.NewObjectID(),
			DocumentID: "doc-42",
			FileName:   "week1.pdf",
			Source:     "web",
			Status:     documentStatusUploaded,
			CreatedAt:  time.Now().UTC().Format(time.RFC3339),
			UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
		},
	}}
	newServer(context.Background(), nil, "mock", nil, nil, documents, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"documents"`)) || !bytes.Contains(rec.Body.Bytes(), []byte(`"documentId":"doc-42"`)) {
		t.Fatalf("expected persisted document in response, got %s", rec.Body.String())
	}
}

func TestListDocumentsRequiresStore(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/documents", nil)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestDocumentFileRequiresBearerToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/documents/doc-42/file", nil)
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, &fakeDocumentStore{}, nil, testAuth, true, &fakeFileStore{}).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestDocumentFileReturnsOwnedFile(t *testing.T) {
	user := User{
		ID:          bson.NewObjectID(),
		Email:       "teacher@example.com",
		DisplayName: "Teacher User",
		Status:      userStatusActive,
	}
	fileID := bson.NewObjectID()
	fileContent := []byte("%PDF-1.4 secure file")
	documents := &fakeDocumentStore{documents: []Document{
		{
			ID:          bson.NewObjectID(),
			UserID:      user.ID,
			DocumentID:  "doc-42",
			FileID:      fileID,
			FileName:    "week1.pdf",
			FileSize:    int64(len(fileContent)),
			ContentType: "application/pdf",
			Status:      documentStatusUploaded,
		},
	}}
	files := &fakeFileStore{files: map[bson.ObjectID][]byte{fileID: fileContent}}
	req := httptest.NewRequest(http.MethodGet, "/documents/doc-42/file", nil)
	req.Header.Set("Authorization", "Bearer "+testBearerTokenForUser(t, user))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, documents, nil, testAuth, true, files).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("expected application/pdf, got %q", rec.Header().Get("Content-Type"))
	}
	if !bytes.Equal(rec.Body.Bytes(), fileContent) {
		t.Fatalf("expected file body %q, got %q", string(fileContent), rec.Body.String())
	}
}

func TestDocumentFileDoesNotExposeOtherUsersFile(t *testing.T) {
	owner := User{
		ID:          bson.NewObjectID(),
		Email:       "owner@example.com",
		DisplayName: "Owner User",
		Status:      userStatusActive,
	}
	requester := User{
		ID:          bson.NewObjectID(),
		Email:       "requester@example.com",
		DisplayName: "Requester User",
		Status:      userStatusActive,
	}
	fileID := bson.NewObjectID()
	documents := &fakeDocumentStore{documents: []Document{
		{
			ID:          bson.NewObjectID(),
			UserID:      owner.ID,
			DocumentID:  "doc-42",
			FileID:      fileID,
			FileName:    "week1.pdf",
			FileSize:    4,
			ContentType: "application/pdf",
			Status:      documentStatusUploaded,
		},
	}}
	files := &fakeFileStore{files: map[bson.ObjectID][]byte{fileID: []byte("file")}}
	req := httptest.NewRequest(http.MethodGet, "/documents/doc-42/file", nil)
	req.Header.Set("Authorization", "Bearer "+testBearerTokenForUser(t, requester))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, documents, nil, testAuth, true, files).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestListExamsReturnsPersistedRecords(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/exams", nil)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	exams := &fakeExamStore{exams: []Exam{
		{
			ID:               bson.NewObjectID(),
			UserID:           bson.NewObjectID(),
			DocumentID:       "doc-42",
			Title:            "Exam for doc-42",
			ValidationResult: "valid",
			Status:           "created",
			CreatedAt:        time.Now().UTC().Format(time.RFC3339),
			UpdatedAt:        time.Now().UTC().Format(time.RFC3339),
		},
	}}
	newServer(context.Background(), nil, "mock", nil, nil, nil, exams, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"exams"`)) || !bytes.Contains(rec.Body.Bytes(), []byte(`"documentId":"doc-42"`)) {
		t.Fatalf("expected persisted exam in response, got %s", rec.Body.String())
	}
}

func TestListExamsRequiresStore(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/exams", nil)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestListActivitiesReturnsPersistedRecords(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/activity?documentId=doc-42", nil)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	activity := &fakeActivityStore{activities: []ActivityEvent{
		{
			ID:         bson.NewObjectID(),
			UserID:     bson.NewObjectID(),
			DocumentID: "doc-42",
			EventType:  "document.received",
			Status:     activityStatusReceived,
			Service:    "api-service",
			Message:    "received",
			CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		},
		{
			ID:         bson.NewObjectID(),
			UserID:     bson.NewObjectID(),
			DocumentID: "doc-99",
			EventType:  "document.received",
			Status:     activityStatusReceived,
			Service:    "api-service",
			Message:    "received",
			CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		},
	}}
	useActivityStore(t, activity)

	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"activities"`)) || !bytes.Contains(rec.Body.Bytes(), []byte(`"documentId":"doc-42"`)) {
		t.Fatalf("expected activity response for doc-42, got %s", rec.Body.String())
	}
	if bytes.Contains(rec.Body.Bytes(), []byte(`"documentId":"doc-99"`)) {
		t.Fatalf("did not expect doc-99 activity in filtered response, got %s", rec.Body.String())
	}
}

func TestListActivitiesRequiresStore(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/activity", nil)
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	useActivityStore(t, nil)
	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestCORSPreflightReturnsNoContent(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/publish", nil)
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

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
	newServer(context.Background(), fake, "pubsub", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

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
	newServer(context.Background(), fake, "pubsub", db, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

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
	newServer(context.Background(), fake, "pubsub", db, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}

	body := rec.Body.String()
	if !bytes.Contains([]byte(body), []byte(`"databaseStatus":"unreachable"`)) {
		t.Fatalf("expected unreachable databaseStatus in response, got %s", body)
	}
}

func TestRegisterCreatesUser(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"Teacher@Example.com","displayName":"Teacher User","password":"strongpass"}`))
	rec := httptest.NewRecorder()

	users := &fakeUserStore{}
	newServer(context.Background(), nil, "mock", nil, users, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	stored, err := users.FindUserByEmail(context.Background(), "teacher@example.com")
	if err != nil {
		t.Fatalf("expected stored user, got %v", err)
	}
	if stored.Email != "teacher@example.com" {
		t.Fatalf("expected normalized email, got %q", stored.Email)
	}
	if stored.PasswordHash == "" || stored.PasswordHash == "strongpass" {
		t.Fatal("expected hashed password")
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("strongpass")) || bytes.Contains(rec.Body.Bytes(), []byte(stored.PasswordHash)) {
		t.Fatalf("did not expect password data in response: %s", rec.Body.String())
	}
}

func TestRegisterRejectsDuplicateEmail(t *testing.T) {
	users := &fakeUserStore{}
	first := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"teacher@example.com","displayName":"Teacher User","password":"strongpass"}`))
	newServer(context.Background(), nil, "mock", nil, users, nil, nil, testAuth, true).ServeHTTP(httptest.NewRecorder(), first)

	second := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"teacher@example.com","displayName":"Teacher User","password":"strongpass"}`))
	rec := httptest.NewRecorder()
	newServer(context.Background(), nil, "mock", nil, users, nil, nil, testAuth, true).ServeHTTP(rec, second)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", rec.Code)
	}
}

func TestRegisterRequiresStrongEnoughPassword(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"teacher@example.com","displayName":"Teacher User","password":"short"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, &fakeUserStore{}, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestLoginReturnsToken(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("strongpass"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash failed: %v", err)
	}
	users := &fakeUserStore{users: map[string]User{
		"teacher@example.com": {
			ID:           bson.NewObjectID(),
			Email:        "teacher@example.com",
			DisplayName:  "Teacher User",
			PasswordHash: string(hash),
			Status:       userStatusActive,
		},
	}}
	req := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewBufferString(`{"email":"teacher@example.com","password":"strongpass"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, users, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"status":"authenticated"`)) {
		t.Fatalf("expected authenticated response, got %s", rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"token"`)) {
		t.Fatalf("expected token in response, got %s", rec.Body.String())
	}

	var response authResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("expected json response, got %v", err)
	}
	if _, err := testAuth.ValidateToken(response.Token); err != nil {
		t.Fatalf("expected valid jwt token, got %v", err)
	}
}

func TestLoginRejectsWrongPassword(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("strongpass"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash failed: %v", err)
	}
	users := &fakeUserStore{users: map[string]User{
		"teacher@example.com": {
			ID:           bson.NewObjectID(),
			Email:        "teacher@example.com",
			DisplayName:  "Teacher User",
			PasswordHash: string(hash),
			Status:       userStatusActive,
		},
	}}
	req := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewBufferString(`{"email":"teacher@example.com","password":"wrongpass"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, users, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAuthEndpointsRequireStore(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"teacher@example.com","displayName":"Teacher User","password":"strongpass"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestLoginRequiresConfiguredJWTSecret(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewBufferString(`{"email":"teacher@example.com","password":"strongpass"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, &fakeUserStore{}, nil, nil, authService{}, false).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestAuthMeRequiresBearerToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAuthMeRejectsInvalidToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAuthMeReturnsAuthenticatedUser(t *testing.T) {
	user := User{
		ID:          bson.NewObjectID(),
		Email:       "teacher@example.com",
		DisplayName: "Teacher User",
		Status:      userStatusActive,
	}
	token, err := testAuth.GenerateToken(user)
	if err != nil {
		t.Fatalf("token generation failed: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"email":"teacher@example.com"`)) {
		t.Fatalf("expected user email in response, got %s", rec.Body.String())
	}
}

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
