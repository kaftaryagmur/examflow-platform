package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
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

type authService struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

type authClaims struct {
	UserID      string `json:"userId"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Status      string `json:"status"`
	jwt.RegisteredClaims
}

type authContextKey string

const authPrincipalKey authContextKey = "authPrincipal"

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

func loginUser(ctx context.Context, users userStore, auth authService, req loginRequest) (User, string, error) {
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

	token, err := auth.GenerateToken(user)
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

func newAuthService(secret string, ttl time.Duration) (authService, bool) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return authService{}, false
	}
	if ttl <= 0 {
		ttl = time.Hour
	}
	return authService{
		secret: []byte(secret),
		ttl:    ttl,
		now:    time.Now,
	}, true
}

func (auth authService) GenerateToken(user User) (string, error) {
	now := auth.now().UTC()
	claims := authClaims{
		UserID:      user.ID.Hex(),
		Email:       user.Email,
		DisplayName: user.DisplayName,
		Status:      user.Status,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID.Hex(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(auth.ttl)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(auth.secret)
}

func (auth authService) ValidateToken(rawToken string) (authClaims, error) {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return authClaims{}, errInvalidLogin
	}

	token, err := jwt.ParseWithClaims(
		rawToken,
		&authClaims{},
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, errInvalidLogin
			}
			return auth.secret, nil
		},
		jwt.WithTimeFunc(auth.now),
	)
	if err != nil {
		return authClaims{}, err
	}

	claims, ok := token.Claims.(*authClaims)
	if !ok || !token.Valid {
		return authClaims{}, errInvalidLogin
	}
	return *claims, nil
}

func (auth authService) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		if header == "" {
			http.Error(w, "missing authorization header", http.StatusUnauthorized)
			return
		}

		parts := strings.Fields(header)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			http.Error(w, "invalid authorization header", http.StatusUnauthorized)
			return
		}

		claims, err := auth.ValidateToken(parts[1])
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), authPrincipalKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func authPrincipalFromContext(ctx context.Context) (authClaims, bool) {
	claims, ok := ctx.Value(authPrincipalKey).(authClaims)
	return claims, ok
}

func userResponseFromClaims(claims authClaims) userResponse {
	return userResponse{
		ID:          claims.UserID,
		Email:       claims.Email,
		DisplayName: claims.DisplayName,
		Status:      claims.Status,
	}
}
