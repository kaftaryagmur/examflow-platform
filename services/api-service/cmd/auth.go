package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"golang.org/x/crypto/bcrypt"
)

const (
	usersCollection = "users"

	userStatusActive   = "active"
	userStatusDisabled = "disabled"
)

var (
	errUserAlreadyExists = errors.New("user already exists")
	errUserNotFound      = errors.New("user not found")
	errInvalidLogin      = errors.New("invalid credentials")
)

type User struct {
	ID           bson.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	Email        string        `bson:"email" json:"email"`
	DisplayName  string        `bson:"displayName" json:"displayName"`
	PasswordHash string        `bson:"passwordHash,omitempty" json:"-"`
	Status       string        `bson:"status" json:"status"`
	CreatedAt    string        `bson:"createdAt" json:"createdAt"`
	UpdatedAt    string        `bson:"updatedAt" json:"updatedAt"`
}

type registerRequest struct {
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type userResponse struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Status      string `json:"status"`
}

type authResponse struct {
	Status string       `json:"status"`
	Token  string       `json:"token,omitempty"`
	User   userResponse `json:"user"`
}

func decodeRegisterRequest(r *http.Request) (registerRequest, error) {
	defer r.Body.Close()

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return registerRequest{}, errors.New("invalid json body")
	}

	req.Email = normalizeEmail(req.Email)
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.Password = strings.TrimSpace(req.Password)

	if req.Email == "" {
		return registerRequest{}, errors.New("email is required")
	}
	if !strings.Contains(req.Email, "@") {
		return registerRequest{}, errors.New("email is invalid")
	}
	if req.DisplayName == "" {
		return registerRequest{}, errors.New("displayName is required")
	}
	if len(req.Password) < 8 {
		return registerRequest{}, errors.New("password must be at least 8 characters")
	}

	return req, nil
}

func decodeLoginRequest(r *http.Request) (loginRequest, error) {
	defer r.Body.Close()

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return loginRequest{}, errors.New("invalid json body")
	}

	req.Email = normalizeEmail(req.Email)
	req.Password = strings.TrimSpace(req.Password)

	if req.Email == "" {
		return loginRequest{}, errors.New("email is required")
	}
	if req.Password == "" {
		return loginRequest{}, errors.New("password is required")
	}

	return req, nil
}

func registerUser(ctx context.Context, users userStore, req registerRequest) (User, error) {
	if _, err := users.FindUserByEmail(ctx, req.Email); err == nil {
		return User{}, errUserAlreadyExists
	} else if !errors.Is(err, errUserNotFound) {
		return User{}, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	user := User{
		ID:           bson.NewObjectID(),
		Email:        req.Email,
		DisplayName:  req.DisplayName,
		PasswordHash: string(hash),
		Status:       userStatusActive,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	return users.CreateUser(ctx, user)
}

func loginUser(ctx context.Context, users userStore, req loginRequest) (User, string, error) {
	user, err := users.FindUserByEmail(ctx, req.Email)
	if err != nil {
		return User{}, "", errInvalidLogin
	}
	if user.Status != userStatusActive {
		return User{}, "", errInvalidLogin
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return User{}, "", errInvalidLogin
	}

	token, err := newAuthToken()
	if err != nil {
		return User{}, "", err
	}
	return user, token, nil
}

func userResponseFromUser(user User) userResponse {
	return userResponse{
		ID:          user.ID.Hex(),
		Email:       user.Email,
		DisplayName: user.DisplayName,
		Status:      user.Status,
	}
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func newAuthToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
