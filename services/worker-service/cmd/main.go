package main

import (
	"context"
	"log"
	"os"
	"time"

	"cloud.google.com/go/pubsub"
)

func main() {
	projectID := os.Getenv("GCP_PROJECT_ID")
	subscriptionID := os.Getenv("PUBSUB_SUBSCRIPTION")

	ctx := context.Background()

	if projectID == "" || subscriptionID == "" {
		log.Println("GCP_PROJECT_ID or PUBSUB_SUBSCRIPTION is missing, worker will run in mock mode")
		for {
			log.Println("mock worker waiting for messages...")
			time.Sleep(10 * time.Second)
		}
	}

	client, err := pubsub.NewClient(ctx, projectID)
	if err != nil {
		log.Fatalf("pubsub client error: %v", err)
	}

	sub := client.Subscription(subscriptionID)

	log.Println("worker-service listening for messages...")

	err = sub.Receive(ctx, func(ctx context.Context, msg *pubsub.Message) {
		log.Printf("received message: %s", string(msg.Data))
		msg.Ack()
	})
	if err != nil {
		log.Fatalf("receive error: %v", err)
	}
}