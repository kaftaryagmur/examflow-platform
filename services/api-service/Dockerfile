FROM golang:1.26.1 AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o api-service ./cmd

FROM gcr.io/distroless/base-debian12

WORKDIR /app

COPY --from=builder /app/api-service .

EXPOSE 8080

CMD ["/app/api-service"]