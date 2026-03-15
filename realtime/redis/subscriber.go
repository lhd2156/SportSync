/*
SportSync Realtime Service - Redis Subscriber

Subscribes to the "score_updates" Redis channel. When the Python
backend publishes a score change, this subscriber picks it up and
broadcasts it to all connected WebSocket clients via the Hub.
*/
package redisclient

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

// ScoreMessage mirrors the JSON structure published by the Python backend
type ScoreMessage struct {
	GameID    string `json:"game_id"`
	HomeTeam  string `json:"home_team"`
	AwayTeam  string `json:"away_team"`
	HomeScore int    `json:"home_score"`
	AwayScore int    `json:"away_score"`
	Status    string `json:"status"`
	Sport     string `json:"sport"`
	League    string `json:"league"`
}

// BroadcastFunc is the function signature for broadcasting to the hub
type BroadcastFunc func(data []byte)

// NewRedisClient creates a pre-configured Redis client
func NewRedisClient() *redis.Client {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379/0"
	}

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Failed to parse Redis URL: %v", err)
	}

	return redis.NewClient(opt)
}

// SubscribeToScores listens to Redis pub/sub channel and calls broadcastFn
// with each message. Automatically reconnects on failure.
func SubscribeToScores(ctx context.Context, rdb *redis.Client, broadcastFn BroadcastFunc) {
	channel := "score_updates"

	for {
		sub := rdb.Subscribe(ctx, channel)
		ch := sub.Channel()

		log.Printf("Subscribed to Redis channel: %s", channel)

		for msg := range ch {
			// Validate JSON before broadcasting
			var score ScoreMessage
			if err := json.Unmarshal([]byte(msg.Payload), &score); err != nil {
				log.Printf("Invalid score message: %v", err)
				continue
			}

			broadcastFn([]byte(msg.Payload))
		}

		// Channel closed, attempt reconnect
		sub.Close()
		log.Printf("Redis subscription lost, reconnecting in 3s...")
		time.Sleep(3 * time.Second)
	}
}
