FROM golang:1.26.1 AS builder

WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o validation-service ./cmd

FROM gcr.io/distroless/base-debian12

WORKDIR /app

COPY --from=builder /app/validation-service .

EXPOSE 8080

CMD ["/app/validation-service"]
