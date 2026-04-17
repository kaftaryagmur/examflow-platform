package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"cloud.google.com/go/pubsub"
)


type Event struct {
	EventType  string `json:"eventType"`
	DocumentID string `json:"documentId"`
	Timestamp  string `json:"timestamp"`
}

func main() {
	projectID := os.Getenv("GCP_PROJECT_ID")
	topicID := os.Getenv("PUBSUB_TOPIC")
	port := os.Getenv("PORT")

	if port == "" {
		port = "8080"
	}

	ctx := context.Background()

	var topic *pubsub.Topic
	if projectID != "" && topicID != "" {
		client, err := pubsub.NewClient(ctx, projectID)
		if err != nil {
			log.Printf("pubsub client could not be created: %v", err)
		} else {
			topic = client.Topic(topicID)
		}
	} else {
		log.Println("GCP_PROJECT_ID or PUBSUB_TOPIC is missing, publish endpoint will run in mock mode")
	}

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	http.HandleFunc("/publish", func(w http.ResponseWriter, r *http.Request) {
		event := Event{
			EventType:  "document.uploaded",
			DocumentID: "doc-001",
			Timestamp:  time.Now().UTC().Format(time.RFC3339),
		}

		payload, err := json.Marshal(event)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if topic == nil {
			log.Printf("mock publish: %s", string(payload))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("mock published: " + string(payload)))
			return
		}

		res := topic.Publish(ctx, &pubsub.Message{
			Data: payload,
		})

		id, err := res.Get(ctx)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("published message id: " + id))
	})

	log.Printf("api-service listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))

	//eren devam edicek.
}