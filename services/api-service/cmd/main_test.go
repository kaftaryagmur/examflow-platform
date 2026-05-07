package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"cloud.google.com/go/pubsub"
	"go.mongodb.org/mongo-driver/v2/bson"
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

func TestPublishRequiresDocumentID(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/publish", bytes.NewBufferString(`{"fileName":"notes.pdf"}`))
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPublishReturnsAcceptedResponse(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/publish", bytes.NewBufferString(`{"documentId":"doc-42","fileName":"week1.pdf","source":"web"}`))
	req.Header.Set("Authorization", "Bearer "+testBearerToken(t))
	rec := httptest.NewRecorder()

	fake := &fakePublisher{result: fakePublishResult{id: "msg-123"}}
	newServer(context.Background(), fake, "pubsub", nil, nil, testAuth, true).ServeHTTP(rec, req)

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
	if !bytes.Contains(fake.lastPayload, []byte(`"userId"`)) {
		t.Fatalf("expected payload to include userId, got %s", string(fake.lastPayload))
	}
}

func TestPublishRequiresBearerToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/publish", bytes.NewBufferString(`{"documentId":"doc-42","fileName":"week1.pdf","source":"web"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestCORSPreflightReturnsNoContent(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/publish", nil)
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, testAuth, true).ServeHTTP(rec, req)

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
	newServer(context.Background(), fake, "pubsub", nil, nil, testAuth, true).ServeHTTP(rec, req)

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
	newServer(context.Background(), fake, "pubsub", db, nil, testAuth, true).ServeHTTP(rec, req)

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
	newServer(context.Background(), fake, "pubsub", db, nil, testAuth, true).ServeHTTP(rec, req)

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
	newServer(context.Background(), nil, "mock", nil, users, testAuth, true).ServeHTTP(rec, req)

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
	newServer(context.Background(), nil, "mock", nil, users, testAuth, true).ServeHTTP(httptest.NewRecorder(), first)

	second := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"teacher@example.com","displayName":"Teacher User","password":"strongpass"}`))
	rec := httptest.NewRecorder()
	newServer(context.Background(), nil, "mock", nil, users, testAuth, true).ServeHTTP(rec, second)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", rec.Code)
	}
}

func TestRegisterRequiresStrongEnoughPassword(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"teacher@example.com","displayName":"Teacher User","password":"short"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, &fakeUserStore{}, testAuth, true).ServeHTTP(rec, req)

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

	newServer(context.Background(), nil, "mock", nil, users, testAuth, true).ServeHTTP(rec, req)

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

	newServer(context.Background(), nil, "mock", nil, users, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAuthEndpointsRequireStore(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewBufferString(`{"email":"teacher@example.com","displayName":"Teacher User","password":"strongpass"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestLoginRequiresConfiguredJWTSecret(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewBufferString(`{"email":"teacher@example.com","password":"strongpass"}`))
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, &fakeUserStore{}, authService{}, false).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

func TestAuthMeRequiresBearerToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAuthMeRejectsInvalidToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := httptest.NewRecorder()

	newServer(context.Background(), nil, "mock", nil, nil, testAuth, true).ServeHTTP(rec, req)

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

	newServer(context.Background(), nil, "mock", nil, nil, testAuth, true).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"email":"teacher@example.com"`)) {
		t.Fatalf("expected user email in response, got %s", rec.Body.String())
	}
}
