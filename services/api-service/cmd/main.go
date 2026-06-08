package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/pubsub"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

func init() {
	log.SetFlags(0)
}

type Event struct {
	EventID     string `json:"eventId,omitempty"`
	EventType   string `json:"eventType"`
	UserID      string `json:"userId"`
	DocumentID  string `json:"documentId"`
	FileName    string `json:"fileName,omitempty"`
	FileSize    int64  `json:"fileSize,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	Source      string `json:"source,omitempty"`
	Timestamp   string `json:"timestamp"`
}

type PublishRequest struct {
	DocumentID      string          `json:"documentId"`
	FileName        string          `json:"fileName"`
	FileSize        int64           `json:"fileSize"`
	ContentType     string          `json:"contentType"`
	Source          string          `json:"source"`
	GenerationPrefs GenerationPrefs `json:"generationPrefs"`
	FileContent     []byte          `json:"-"`
}

type PublishResponse struct {
	Status    string `json:"status"`
	MessageID string `json:"messageId,omitempty"`
	Mode      string `json:"mode"`
	Event     Event  `json:"event"`
}

type StatusResponse struct {
	Status         string `json:"status"`
	Service        string `json:"service"`
	Mode           string `json:"mode"`
	DatabaseStatus string `json:"databaseStatus,omitempty"`
	DatabaseName   string `json:"databaseName,omitempty"`
	Timestamp      string `json:"timestamp"`
}

type publisher interface {
	Publish(context.Context, *pubsub.Message) publishResult
}

type publishResult interface {
	Get(context.Context) (string, error)
}

type topicPublisher struct {
	topic *pubsub.Topic
}

type mongoDBConfig struct {
	URI      string
	Database string
}

type databaseClient interface {
	Name() string
	Ping(context.Context) error
	VerifyReadWrite(context.Context, string) error
	Close(context.Context) error
}

type mongoDatabaseClient struct {
	client   *mongo.Client
	database *mongo.Database
	name     string
}

type userStore interface {
	CreateUser(context.Context, User) (User, error)
	FindUserByID(context.Context, string) (User, error)
	FindUserByEmail(context.Context, string) (User, error)
	ListUsers(context.Context) ([]User, error)
	UpdateUser(context.Context, User) (User, error)
	DeleteUser(context.Context, string) error
}

type mongoUserStore struct {
	collection *mongo.Collection
}

type documentStore interface {
	CreateDocument(context.Context, Document) (Document, error)
	FindDocument(context.Context, string, string) (Document, error)
	ListDocuments(context.Context, string) ([]Document, error)
	ListAllDocuments(context.Context) ([]Document, error)
	UpdateDocumentMetadata(context.Context, string, string, RecordMetadataRequest) (Document, error)
}

type mongoDocumentStore struct {
	collection *mongo.Collection
}

type documentFileStore interface {
	SaveDocumentFile(context.Context, PublishRequest, string) (bson.ObjectID, error)
	OpenDocumentFile(context.Context, bson.ObjectID) (io.ReadCloser, error)
}

type mongoDocumentFileStore struct {
	bucket *mongo.GridFSBucket
}

type examStore interface {
	ListExams(context.Context, string) ([]Exam, error)
	ListAllExams(context.Context) ([]Exam, error)
	UpdateExamMetadata(context.Context, string, string, RecordMetadataRequest) (Exam, error)
}

type mongoExamStore struct {
	collection *mongo.Collection
}

const (
	publishFileFieldName     = "file"
	maxUploadBytes           = 20 << 20
	maxMultipartRequestBytes = maxUploadBytes + (1 << 20)
	multipartMaxMemory       = 8 << 20
)

func (t topicPublisher) Publish(ctx context.Context, msg *pubsub.Message) publishResult {
	return t.topic.Publish(ctx, msg)
}

func main() {
	projectID := os.Getenv("GCP_PROJECT_ID")
	topicID := os.Getenv("PUBSUB_TOPIC")
	port := os.Getenv("PORT")
	jwtSecret := os.Getenv("JWT_SECRET")

	if port == "" {
		port = "8080"
	}

	ctx := context.Background()
	mode := "mock"

	var pub publisher
	if projectID != "" && topicID != "" {
		client, err := pubsub.NewClient(ctx, projectID)
		if err != nil {
			logKV("warn", "api-service", "pubsub client could not be created", "error", err.Error())
		} else {
			pub = topicPublisher{topic: client.Topic(topicID)}
			mode = "pubsub"
		}
	} else {
		logKV("info", "api-service", "missing pubsub configuration, running in mock mode")
	}

	var users userStore
	var documents documentStore
	var files documentFileStore
	var exams examStore
	db, err := connectMongoDB(ctx)
	if err != nil {
		logKV("warn", "api-service", "mongodb connection unavailable", "error", err.Error())
	} else {
		defer db.Close(ctx)
		if err := db.VerifyReadWrite(ctx, "api-service"); err != nil {
			logKV("warn", "api-service", "mongodb startup read/write check failed", "database", db.Name(), "error", err.Error())
		} else {
			logKV("info", "api-service", "mongodb connection ready", "database", db.Name())
		}
		if mongoDB, ok := db.(*mongoDatabaseClient); ok {
			users = mongoUserStore{collection: mongoDB.database.Collection(usersCollection)}
			documents = mongoDocumentStore{collection: mongoDB.database.Collection(documentsCollection)}
			files = mongoDocumentFileStore{bucket: mongoDB.database.GridFSBucket()}
			exams = mongoExamStore{collection: mongoDB.database.Collection(examsCollection)}
			activities = mongoActivityStore{collection: mongoDB.database.Collection(activityEventsCollection)}
			if err := ensureUserIndexes(ctx, users); err != nil {
				logKV("warn", "api-service", "mongodb user index setup failed", "database", db.Name(), "error", err.Error())
			}
			if err := ensureDefaultAdminUser(ctx, users); err != nil {
				logKV("warn", "api-service", "default admin user setup failed", "database", db.Name(), "error", err.Error())
			}
			if err := ensureActivityIndexes(ctx, activities); err != nil {
				logKV("warn", "api-service", "mongodb activity index setup failed", "database", db.Name(), "error", err.Error())
			}
		}
	}

	auth, authConfigured := newAuthService(jwtSecret, 2*time.Hour)
	if !authConfigured {
		logKV("warn", "api-service", "jwt secret not configured, auth endpoints degraded")
	}

	handler := newServer(ctx, pub, mode, db, users, documents, exams, auth, authConfigured, files)

	logKV("info", "api-service", "listening", "port", port, "mode", mode)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		logKV("error", "api-service", "http server stopped", "error", err.Error())
		os.Exit(1)
	}
}

func newServer(ctx context.Context, pub publisher, mode string, db databaseClient, users userStore, documents documentStore, exams examStore, auth authService, authConfigured bool, optionalFileStores ...documentFileStore) http.Handler {
	mux := http.NewServeMux()
	var files documentFileStore
	if len(optionalFileStores) > 0 {
		files = optionalFileStores[0]
	}

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, StatusResponse{
			Status:    "ok",
			Service:   "api-service",
			Mode:      mode,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		status := http.StatusOK
		body := StatusResponse{
			Status:         "ready",
			Service:        "api-service",
			Mode:           mode,
			DatabaseStatus: "not_configured",
			Timestamp:      time.Now().UTC().Format(time.RFC3339),
		}
		if pub == nil {
			status = http.StatusAccepted
			body.Status = "degraded"
		}

		if db != nil {
			body.DatabaseName = db.Name()
			if err := db.Ping(r.Context()); err != nil {
				status = http.StatusServiceUnavailable
				body.Status = "degraded"
				body.DatabaseStatus = "unreachable"
				logKV("warn", "api-service", "mongodb readiness check failed", "database", db.Name(), "error", err.Error())
			} else {
				body.DatabaseStatus = "ready"
			}
		}
		writeJSON(w, status, body)
	})

	publishHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		claims, ok := authPrincipalFromContext(r.Context())
		if !ok {
			http.Error(w, "auth context unavailable", http.StatusUnauthorized)
			return
		}
		if documents == nil {
			http.Error(w, "document store unavailable", http.StatusServiceUnavailable)
			return
		}
		if files == nil {
			http.Error(w, "file store unavailable", http.StatusServiceUnavailable)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxMultipartRequestBytes)
		req, err := decodePublishRequest(r)
		if err != nil {
			logKV("warn", "api-service", "invalid request", "endpoint", "/publish", "error", err.Error())
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		event := buildEvent(req, claims.UserID)
		fileID, err := files.SaveDocumentFile(r.Context(), req, claims.UserID)
		if err != nil {
			logKV("error", "api-service", "file storage failed", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "user_id", event.UserID, "file_name", event.FileName, "error", err.Error())
			http.Error(w, "file storage failed", http.StatusInternalServerError)
			return
		}

		document, err := buildDocumentRecord(req, claims.UserID, fileID)
		if err != nil {
			logKV("warn", "api-service", "document ownership validation failed", "endpoint", "/publish", "error", err.Error())
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if _, err := documents.CreateDocument(r.Context(), document); err != nil {
			logKV("error", "api-service", "document persistence failed", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "user_id", event.UserID, "error", err.Error())
			http.Error(w, "document persistence failed", http.StatusInternalServerError)
			return
		}
		recordPublishActivity(
			r.Context(),
			event,
			activityStatusReceived,
			"document.received",
			"Dokuman alindi ve MongoDB dokuman kaydi olusturuldu.",
			"",
		)

		logKV(
			"info", "api-service", "request received",
			"endpoint", "/publish",
			"user_id", event.UserID,
			"document_id", event.DocumentID,
			"file_name", event.FileName,
			"file_id", document.FileID.Hex(),
			"source", event.Source,
			"mode", mode,
		)

		payload, err := json.Marshal(event)
		if err != nil {
			logKV("error", "api-service", "event marshal failed", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())
			recordPublishActivity(r.Context(), event, activityStatusFailed, "document.publish.failed", "Dokuman eventi olusturulamadi.", err.Error())
			http.Error(w, "could not create event payload", http.StatusInternalServerError)
			return
		}

		if pub == nil {
			logKV("info", "api-service", "mock event published", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "payload", string(payload))
			recordPublishActivity(
				r.Context(),
				event,
				activityStatusPublished,
				"document.published",
				"Dokuman eventi mock modda yayinlandi.",
				"",
			)
			writeJSON(w, http.StatusOK, PublishResponse{
				Status: "accepted",
				Mode:   mode,
				Event:  event,
			})
			return
		}

		logKV("info", "api-service", "publishing event", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "event_type", event.EventType)
		messageID, err := pub.Publish(ctx, &pubsub.Message{Data: payload}).Get(ctx)
		if err != nil {
			logKV("error", "api-service", "publish failed", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "error", err.Error())
			recordPublishActivity(r.Context(), event, activityStatusFailed, "document.publish.failed", "Dokuman eventi Pub/Sub kuyruguna gonderilemedi.", err.Error())
			http.Error(w, "publish failed", http.StatusInternalServerError)
			return
		}

		logKV("info", "api-service", "event published", "endpoint", "/publish", "event_id", event.EventID, "document_id", event.DocumentID, "message_id", messageID)
		recordPublishActivity(
			r.Context(),
			event,
			activityStatusPublished,
			"document.published",
			"Dokuman eventi Pub/Sub kuyruguna gonderildi.",
			"",
		)
		writeJSON(w, http.StatusOK, PublishResponse{
			Status:    "accepted",
			MessageID: messageID,
			Mode:      mode,
			Event:     event,
		})
	})
	if authConfigured {
		mux.Handle("/publish", auth.RequireAuth(publishHandler))
	} else {
		mux.HandleFunc("/publish", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "auth token signing unavailable", http.StatusServiceUnavailable)
			return
		})
	}

	listDocumentsHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		claims, ok := authPrincipalFromContext(r.Context())
		if !ok {
			http.Error(w, "auth context unavailable", http.StatusUnauthorized)
			return
		}
		if documents == nil {
			http.Error(w, "document store unavailable", http.StatusServiceUnavailable)
			return
		}
		records, err := documents.ListDocuments(r.Context(), claims.UserID)
		if err != nil {
			logKV("error", "api-service", "document read failed", "endpoint", "/documents", "user_id", claims.UserID, "error", err.Error())
			http.Error(w, "document read failed", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"documents": records})
	})

	documentRecordHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := documentMetadataIDFromPath(r.URL.Path); ok {
			updateDocumentMetadataHandler(documents).ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		claims, ok := authPrincipalFromContext(r.Context())
		if !ok {
			http.Error(w, "auth context unavailable", http.StatusUnauthorized)
			return
		}
		if documents == nil {
			http.Error(w, "document store unavailable", http.StatusServiceUnavailable)
			return
		}
		if files == nil {
			http.Error(w, "file store unavailable", http.StatusServiceUnavailable)
			return
		}

		documentID, ok := documentIDFromFilePath(r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}

		document, err := documents.FindDocument(r.Context(), claims.UserID, documentID)
		if errors.Is(err, errDocumentNotFound) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			logKV("error", "api-service", "document file metadata read failed", "endpoint", "/documents/{documentId}/file", "user_id", claims.UserID, "document_id", documentID, "error", err.Error())
			http.Error(w, "document read failed", http.StatusInternalServerError)
			return
		}
		if document.FileID.IsZero() {
			http.NotFound(w, r)
			return
		}

		stream, err := files.OpenDocumentFile(r.Context(), document.FileID)
		if errors.Is(err, mongo.ErrFileNotFound) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			logKV("error", "api-service", "document file stream failed", "endpoint", "/documents/{documentId}/file", "user_id", claims.UserID, "document_id", documentID, "file_id", document.FileID.Hex(), "error", err.Error())
			http.Error(w, "file stream failed", http.StatusInternalServerError)
			return
		}
		defer stream.Close()

		contentType := strings.TrimSpace(document.ContentType)
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, sanitizeContentDispositionFileName(document.FileName)))
		if document.FileSize > 0 {
			w.Header().Set("Content-Length", fmt.Sprint(document.FileSize))
		}

		if _, err := io.Copy(w, stream); err != nil {
			logKV("warn", "api-service", "document file response copy failed", "endpoint", "/documents/{documentId}/file", "user_id", claims.UserID, "document_id", documentID, "file_id", document.FileID.Hex(), "error", err.Error())
		}
	})

	listExamsHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		claims, ok := authPrincipalFromContext(r.Context())
		if !ok {
			http.Error(w, "auth context unavailable", http.StatusUnauthorized)
			return
		}
		if exams == nil {
			http.Error(w, "exam store unavailable", http.StatusServiceUnavailable)
			return
		}
		records, err := exams.ListExams(r.Context(), claims.UserID)
		if err != nil {
			logKV("error", "api-service", "exam read failed", "endpoint", "/exams", "user_id", claims.UserID, "error", err.Error())
			http.Error(w, "exam read failed", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"exams": records})
	})

	examRecordHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := examMetadataIDFromPath(r.URL.Path); ok {
			updateExamMetadataHandler(exams).ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})

	listActivitiesHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		claims, ok := authPrincipalFromContext(r.Context())
		if !ok {
			http.Error(w, "auth context unavailable", http.StatusUnauthorized)
			return
		}
		if activities == nil {
			http.Error(w, "activity store unavailable", http.StatusServiceUnavailable)
			return
		}
		records, err := activities.ListActivities(r.Context(), claims.UserID, r.URL.Query().Get("documentId"))
		if err != nil {
			logKV("error", "api-service", "activity read failed", "endpoint", "/activity", "user_id", claims.UserID, "error", err.Error())
			http.Error(w, "activity read failed", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"activities": records})
	})

	if authConfigured {
		mux.Handle("/documents", auth.RequireAuth(listDocumentsHandler))
		mux.Handle("/documents/", auth.RequireAuth(documentRecordHandler))
		mux.Handle("/exams", auth.RequireAuth(listExamsHandler))
		mux.Handle("/exams/", auth.RequireAuth(examRecordHandler))
		mux.Handle("/activity", auth.RequireAuth(listActivitiesHandler))
	} else {
		mux.HandleFunc("/documents", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "auth token signing unavailable", http.StatusServiceUnavailable)
		})
		mux.HandleFunc("/documents/", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "auth token signing unavailable", http.StatusServiceUnavailable)
		})
		mux.HandleFunc("/exams", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "auth token signing unavailable", http.StatusServiceUnavailable)
		})
		mux.HandleFunc("/exams/", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "auth token signing unavailable", http.StatusServiceUnavailable)
		})
		mux.HandleFunc("/activity", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "auth token signing unavailable", http.StatusServiceUnavailable)
		})
	}

	mux.HandleFunc("/auth/register", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if users == nil {
			http.Error(w, "auth store unavailable", http.StatusServiceUnavailable)
			return
		}

		req, err := decodeRegisterRequest(r)
		if err != nil {
			logKV("warn", "api-service", "invalid auth request", "endpoint", "/auth/register", "error", err.Error())
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		user, err := registerUser(r.Context(), users, req)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errUserAlreadyExists) {
				status = http.StatusConflict
			}
			logKV("warn", "api-service", "register failed", "endpoint", "/auth/register", "email", normalizeEmail(req.Email), "error", err.Error())
			http.Error(w, err.Error(), status)
			return
		}

		logKV("info", "api-service", "user registered", "endpoint", "/auth/register", "user_id", user.ID.Hex(), "email", user.Email)
		writeJSON(w, http.StatusCreated, authResponse{
			Status: "registered",
			User:   userResponseFromUser(user),
		})
	})

	mux.HandleFunc("/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if users == nil {
			http.Error(w, "auth store unavailable", http.StatusServiceUnavailable)
			return
		}
		if !authConfigured {
			http.Error(w, "auth token signing unavailable", http.StatusServiceUnavailable)
			return
		}

		req, err := decodeLoginRequest(r)
		if err != nil {
			logKV("warn", "api-service", "invalid auth request", "endpoint", "/auth/login", "error", err.Error())
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		user, token, err := loginUser(r.Context(), users, auth, req)
		if err != nil {
			logKV("warn", "api-service", "login failed", "endpoint", "/auth/login", "email", normalizeEmail(req.Email), "error", err.Error())
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}

		logKV("info", "api-service", "user logged in", "endpoint", "/auth/login", "user_id", user.ID.Hex(), "email", user.Email)
		writeJSON(w, http.StatusOK, authResponse{
			Status: "authenticated",
			Token:  token,
			User:   userResponseFromUser(user),
		})
	})

	if authConfigured {
		mux.Handle("/auth/me", auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet && r.Method != http.MethodPatch {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}

			claims, ok := authPrincipalFromContext(r.Context())
			if !ok {
				http.Error(w, "auth context unavailable", http.StatusUnauthorized)
				return
			}

			if r.Method == http.MethodGet {
				writeJSON(w, http.StatusOK, authResponse{
					Status: "authenticated",
					User:   userResponseFromClaims(claims),
				})
				return
			}

			if users == nil {
				http.Error(w, "auth store unavailable", http.StatusServiceUnavailable)
				return
			}
			req, err := decodeUpdateProfileRequest(r)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			user, token, err := updateUserProfile(r.Context(), users, auth, claims.UserID, req)
			if errors.Is(err, errInvalidLogin) {
				http.Error(w, "invalid current password", http.StatusUnauthorized)
				return
			}
			if err != nil {
				logKV("error", "api-service", "profile update failed", "endpoint", "/auth/me", "user_id", claims.UserID, "error", err.Error())
				http.Error(w, "profile update failed", http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, authResponse{
				Status: "authenticated",
				Token:  token,
				User:   userResponseFromUser(user),
			})
		})))

		mux.Handle("/admin/users", auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := authPrincipalFromContext(r.Context())
			if !ok {
				http.Error(w, "auth context unavailable", http.StatusUnauthorized)
				return
			}
			if !isAdminClaims(claims) {
				http.Error(w, "admin access required", http.StatusForbidden)
				return
			}
			if users == nil {
				http.Error(w, "auth store unavailable", http.StatusServiceUnavailable)
				return
			}

			switch r.Method {
			case http.MethodGet:
				records, err := users.ListUsers(r.Context())
				if err != nil {
					logKV("error", "api-service", "admin user list failed", "endpoint", "/admin/users", "user_id", claims.UserID, "error", err.Error())
					http.Error(w, "user list failed", http.StatusInternalServerError)
					return
				}
				responses := make([]userResponse, 0, len(records))
				for _, user := range records {
					responses = append(responses, userResponseFromUser(user))
				}
				writeJSON(w, http.StatusOK, map[string]any{"users": responses})
			case http.MethodPost:
				req, err := decodeRegisterRequest(r)
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				user, err := registerUser(r.Context(), users, req)
				if err != nil {
					status := http.StatusInternalServerError
					if errors.Is(err, errUserAlreadyExists) {
						status = http.StatusConflict
					}
					http.Error(w, err.Error(), status)
					return
				}
				writeJSON(w, http.StatusCreated, map[string]any{"user": userResponseFromUser(user)})
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		})))

		mux.Handle("/admin/users/", auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := authPrincipalFromContext(r.Context())
			if !ok {
				http.Error(w, "auth context unavailable", http.StatusUnauthorized)
				return
			}
			if !isAdminClaims(claims) {
				http.Error(w, "admin access required", http.StatusForbidden)
				return
			}
			if users == nil {
				http.Error(w, "auth store unavailable", http.StatusServiceUnavailable)
				return
			}
			if r.Method != http.MethodDelete {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}

			userID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/admin/users/"), "/")
			if userID == "" {
				http.NotFound(w, r)
				return
			}
			if userID == claims.UserID {
				http.Error(w, "current admin user cannot be deleted", http.StatusBadRequest)
				return
			}
			if err := users.DeleteUser(r.Context(), userID); err != nil {
				if errors.Is(err, errUserNotFound) {
					http.NotFound(w, r)
					return
				}
				logKV("error", "api-service", "admin user delete failed", "endpoint", "/admin/users/{userId}", "admin_user_id", claims.UserID, "target_user_id", userID, "error", err.Error())
				http.Error(w, "user delete failed", http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "userId": userID})
		})))

		mux.Handle("/admin/documents", auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := authPrincipalFromContext(r.Context())
			if !ok {
				http.Error(w, "auth context unavailable", http.StatusUnauthorized)
				return
			}
			if !isAdminClaims(claims) {
				http.Error(w, "admin access required", http.StatusForbidden)
				return
			}
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if documents == nil {
				http.Error(w, "document store unavailable", http.StatusServiceUnavailable)
				return
			}
			records, err := documents.ListAllDocuments(r.Context())
			if err != nil {
				logKV("error", "api-service", "admin document list failed", "endpoint", "/admin/documents", "user_id", claims.UserID, "error", err.Error())
				http.Error(w, "document list failed", http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"documents": records})
		})))

		mux.Handle("/admin/exams", auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := authPrincipalFromContext(r.Context())
			if !ok {
				http.Error(w, "auth context unavailable", http.StatusUnauthorized)
				return
			}
			if !isAdminClaims(claims) {
				http.Error(w, "admin access required", http.StatusForbidden)
				return
			}
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if exams == nil {
				http.Error(w, "exam store unavailable", http.StatusServiceUnavailable)
				return
			}
			records, err := exams.ListAllExams(r.Context())
			if err != nil {
				logKV("error", "api-service", "admin exam list failed", "endpoint", "/admin/exams", "user_id", claims.UserID, "error", err.Error())
				http.Error(w, "exam list failed", http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"exams": records})
		})))

		mux.Handle("/admin/activity", auth.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := authPrincipalFromContext(r.Context())
			if !ok {
				http.Error(w, "auth context unavailable", http.StatusUnauthorized)
				return
			}
			if !isAdminClaims(claims) {
				http.Error(w, "admin access required", http.StatusForbidden)
				return
			}
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if activities == nil {
				http.Error(w, "activity store unavailable", http.StatusServiceUnavailable)
				return
			}
			records, err := activities.ListAllActivities(r.Context(), r.URL.Query().Get("documentId"))
			if err != nil {
				logKV("error", "api-service", "admin activity list failed", "endpoint", "/admin/activity", "user_id", claims.UserID, "error", err.Error())
				http.Error(w, "activity list failed", http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"activities": records})
		})))
	} else {
		mux.HandleFunc("/auth/me", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "auth token signing unavailable", http.StatusServiceUnavailable)
			return
		})
	}

	return withCORS(withRequestLogging("api-service", mux))
}

func decodePublishRequest(r *http.Request) (PublishRequest, error) {
	defer r.Body.Close()

	contentType := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
	if !strings.HasPrefix(contentType, "multipart/form-data") {
		return PublishRequest{}, errors.New("content-type must be multipart/form-data")
	}

	return decodeMultipartPublishRequest(r)
}

func decodeMultipartPublishRequest(r *http.Request) (PublishRequest, error) {
	if err := r.ParseMultipartForm(multipartMaxMemory); err != nil {
		return PublishRequest{}, errors.New("invalid multipart form data")
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, header, err := r.FormFile(publishFileFieldName)
	if err != nil {
		return PublishRequest{}, errors.New("file is required")
	}
	defer file.Close()

	fileName := strings.TrimSpace(header.Filename)
	if fileName == "" {
		return PublishRequest{}, errors.New("file name is required")
	}
	if !isAllowedDocumentFile(fileName) {
		return PublishRequest{}, errors.New("only .pdf and .docx files are allowed")
	}

	content, err := readUploadFile(file)
	if err != nil {
		return PublishRequest{}, err
	}

	documentID := strings.TrimSpace(r.FormValue("documentId"))
	if documentID == "" {
		documentID = fmt.Sprintf("doc-%d", time.Now().UTC().UnixNano())
	}

	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = http.DetectContentType(content)
	}

	req := PublishRequest{
		DocumentID:      documentID,
		FileName:        fileName,
		FileSize:        int64(len(content)),
		ContentType:     contentType,
		Source:          strings.TrimSpace(r.FormValue("source")),
		GenerationPrefs: parseGenerationPrefs(r),
		FileContent:     content,
	}
	if strings.TrimSpace(req.Source) == "" {
		req.Source = "manual"
	}

	return req, nil
}

// parseGenerationPrefs reads the optional generation preference form fields.
// Invalid or out-of-range values are normalized later by normalizeGenerationPrefs.
func parseGenerationPrefs(r *http.Request) GenerationPrefs {
	prefs := GenerationPrefs{
		Difficulty: strings.TrimSpace(r.FormValue("difficulty")),
		Focus:      strings.TrimSpace(r.FormValue("focus")),
	}
	if v, err := strconv.Atoi(strings.TrimSpace(r.FormValue("questionCount"))); err == nil {
		prefs.QuestionCount = v
	}
	if v, err := strconv.Atoi(strings.TrimSpace(r.FormValue("infoCardCount"))); err == nil {
		prefs.InfoCardCount = v
	}
	return normalizeGenerationPrefs(prefs)
}

func readUploadFile(file multipart.File) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		return nil, errors.New("could not read uploaded file")
	}
	if len(content) == 0 {
		return nil, errors.New("file must not be empty")
	}
	if int64(len(content)) > maxUploadBytes {
		return nil, fmt.Errorf("file is too large, max size is %d bytes", maxUploadBytes)
	}
	return content, nil
}

func documentIDFromFilePath(path string) (string, bool) {
	const prefix = "/documents/"
	const suffix = "/file"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}

	rawDocumentID := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	rawDocumentID = strings.Trim(rawDocumentID, "/")
	if rawDocumentID == "" || strings.Contains(rawDocumentID, "/") {
		return "", false
	}

	documentID, err := url.PathUnescape(rawDocumentID)
	if err != nil {
		return "", false
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return "", false
	}
	return documentID, true
}

func sanitizeContentDispositionFileName(fileName string) string {
	fileName = filepath.Base(strings.TrimSpace(fileName))
	fileName = strings.ReplaceAll(fileName, `"`, "")
	fileName = strings.ReplaceAll(fileName, "\r", "")
	fileName = strings.ReplaceAll(fileName, "\n", "")
	if fileName == "." || fileName == string(filepath.Separator) || fileName == "" {
		return "document"
	}
	return fileName
}

func isAllowedDocumentFile(fileName string) bool {
	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".pdf", ".docx":
		return true
	default:
		return false
	}
}

func buildEvent(req PublishRequest, userID string) Event {
	return Event{
		EventID:     fmt.Sprintf("upload-%s-%d", strings.TrimSpace(req.DocumentID), time.Now().UTC().UnixNano()),
		EventType:   "document.uploaded",
		UserID:      strings.TrimSpace(userID),
		DocumentID:  strings.TrimSpace(req.DocumentID),
		FileName:    strings.TrimSpace(req.FileName),
		FileSize:    req.FileSize,
		ContentType: strings.TrimSpace(req.ContentType),
		Source:      strings.TrimSpace(req.Source),
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
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

func connectMongoDB(ctx context.Context) (databaseClient, error) {
	config, ok := loadMongoDBConfig()
	if !ok {
		return nil, nil
	}

	client, err := mongo.Connect(options.Client().ApplyURI(config.URI))
	if err != nil {
		return nil, err
	}

	db := &mongoDatabaseClient{
		client:   client,
		database: client.Database(config.Database),
		name:     config.Database,
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.Ping(pingCtx); err != nil {
		_ = db.Close(context.Background())
		return nil, err
	}

	return db, nil
}

func (db *mongoDatabaseClient) Name() string {
	return db.name
}

func (db *mongoDatabaseClient) Ping(ctx context.Context) error {
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return db.client.Ping(pingCtx, readpref.Primary())
}

func (db *mongoDatabaseClient) VerifyReadWrite(ctx context.Context, service string) error {
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	id := bson.NewObjectID()
	collection := db.database.Collection("connection_checks")
	document := bson.M{
		"_id":       id,
		"service":   service,
		"checkedAt": time.Now().UTC(),
	}

	if _, err := collection.InsertOne(checkCtx, document); err != nil {
		return err
	}

	var stored struct {
		ID bson.ObjectID `bson:"_id"`
	}
	if err := collection.FindOne(checkCtx, bson.M{"_id": id}).Decode(&stored); err != nil {
		return err
	}
	if stored.ID != id {
		return fmt.Errorf("mongodb read/write check returned unexpected id")
	}
	return nil
}

func (db *mongoDatabaseClient) Close(ctx context.Context) error {
	closeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return db.client.Disconnect(closeCtx)
}

func (store mongoUserStore) CreateUser(ctx context.Context, user User) (User, error) {
	saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if user.ID.IsZero() {
		user.ID = bson.NewObjectID()
	}
	_, err := store.collection.InsertOne(saveCtx, user)
	if mongo.IsDuplicateKeyError(err) {
		return User{}, errUserAlreadyExists
	}
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (store mongoUserStore) FindUserByEmail(ctx context.Context, email string) (User, error) {
	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var user User
	err := store.collection.FindOne(findCtx, bson.M{"email": normalizeEmail(email)}).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return User{}, errUserNotFound
	}
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (store mongoUserStore) FindUserByID(ctx context.Context, userID string) (User, error) {
	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	userObjectID, err := bson.ObjectIDFromHex(strings.TrimSpace(userID))
	if err != nil {
		return User{}, errUserNotFound
	}

	var user User
	err = store.collection.FindOne(findCtx, bson.M{"_id": userObjectID}).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return User{}, errUserNotFound
	}
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (store mongoUserStore) ListUsers(ctx context.Context) ([]User, error) {
	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cursor, err := store.collection.Find(findCtx, bson.M{}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(findCtx)

	var users []User
	if err := cursor.All(findCtx, &users); err != nil {
		return nil, err
	}
	return users, nil
}

func (store mongoUserStore) UpdateUser(ctx context.Context, user User) (User, error) {
	saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if user.ID.IsZero() {
		return User{}, errUserNotFound
	}
	_, err := store.collection.UpdateOne(saveCtx, bson.M{"_id": user.ID}, bson.M{"$set": bson.M{
		"displayName":  user.DisplayName,
		"passwordHash": user.PasswordHash,
		"role":         normalizeUserRole(user.Role),
		"status":       user.Status,
		"updatedAt":    user.UpdatedAt,
	}})
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (store mongoUserStore) DeleteUser(ctx context.Context, userID string) error {
	deleteCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	userObjectID, err := bson.ObjectIDFromHex(strings.TrimSpace(userID))
	if err != nil {
		return errUserNotFound
	}
	result, err := store.collection.DeleteOne(deleteCtx, bson.M{"_id": userObjectID})
	if err != nil {
		return err
	}
	if result.DeletedCount == 0 {
		return errUserNotFound
	}
	return nil
}

func (store mongoDocumentStore) CreateDocument(ctx context.Context, document Document) (Document, error) {
	saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if document.ID.IsZero() {
		document.ID = bson.NewObjectID()
	}
	_, err := store.collection.InsertOne(saveCtx, document)
	if err != nil {
		return Document{}, err
	}
	return document, nil
}

func (store mongoDocumentStore) FindDocument(ctx context.Context, userID string, documentID string) (Document, error) {
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return Document{}, err
	}

	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var document Document
	err = store.collection.FindOne(
		findCtx,
		bson.M{
			"userId":     userObjectID,
			"documentId": strings.TrimSpace(documentID),
		},
	).Decode(&document)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Document{}, errDocumentNotFound
	}
	if err != nil {
		return Document{}, err
	}
	return document, nil
}

func (store mongoDocumentStore) ListDocuments(ctx context.Context, userID string) ([]Document, error) {
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return nil, err
	}

	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cursor, err := store.collection.Find(
		findCtx,
		bson.M{"userId": userObjectID},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(findCtx)

	var documents []Document
	if err := cursor.All(findCtx, &documents); err != nil {
		return nil, err
	}
	return documents, nil
}

func (store mongoDocumentStore) ListAllDocuments(ctx context.Context) ([]Document, error) {
	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cursor, err := store.collection.Find(
		findCtx,
		bson.M{},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(300),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(findCtx)

	var documents []Document
	if err := cursor.All(findCtx, &documents); err != nil {
		return nil, err
	}
	return documents, nil
}

func (store mongoDocumentFileStore) SaveDocumentFile(ctx context.Context, req PublishRequest, userID string) (bson.ObjectID, error) {
	saveCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	metadata := bson.D{
		{Key: "documentId", Value: strings.TrimSpace(req.DocumentID)},
		{Key: "userId", Value: strings.TrimSpace(userID)},
		{Key: "contentType", Value: strings.TrimSpace(req.ContentType)},
		{Key: "source", Value: strings.TrimSpace(req.Source)},
		{Key: "uploadedAt", Value: time.Now().UTC().Format(time.RFC3339)},
	}

	return store.bucket.UploadFromStream(
		saveCtx,
		strings.TrimSpace(req.FileName),
		bytes.NewReader(req.FileContent),
		options.GridFSUpload().SetMetadata(metadata),
	)
}

func (store mongoDocumentFileStore) OpenDocumentFile(ctx context.Context, fileID bson.ObjectID) (io.ReadCloser, error) {
	return store.bucket.OpenDownloadStream(ctx, fileID)
}

func (store mongoExamStore) ListExams(ctx context.Context, userID string) ([]Exam, error) {
	userObjectID, err := objectIDFromUserID(userID)
	if err != nil {
		return nil, err
	}

	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cursor, err := store.collection.Find(
		findCtx,
		bson.M{"userId": userObjectID},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(findCtx)

	var exams []Exam
	if err := cursor.All(findCtx, &exams); err != nil {
		return nil, err
	}
	return exams, nil
}

func (store mongoExamStore) ListAllExams(ctx context.Context) ([]Exam, error) {
	findCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cursor, err := store.collection.Find(
		findCtx,
		bson.M{},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(300),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(findCtx)

	var exams []Exam
	if err := cursor.All(findCtx, &exams); err != nil {
		return nil, err
	}
	return exams, nil
}

func ensureUserIndexes(ctx context.Context, users userStore) error {
	store, ok := users.(mongoUserStore)
	if !ok {
		return nil
	}

	indexCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, err := store.collection.Indexes().CreateOne(indexCtx, mongo.IndexModel{
		Keys:    bson.D{{Key: "email", Value: 1}},
		Options: options.Index().SetUnique(true).SetName("users_email_unique"),
	})
	return err
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func withRequestLogging(service string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(recorder, r)

		logKV(
			"info", service, "request completed",
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"duration_ms", time.Since(start).Milliseconds(),
			"remote_addr", r.RemoteAddr,
		)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
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
