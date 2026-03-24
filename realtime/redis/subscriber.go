/*
SportSync realtime Redis subscriber.

Subscribes to the shared live score channel. When the Python backend publishes a
score change, this subscriber picks it up and broadcasts it to connected
WebSocket clients through the hub.
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

// ScoreMessage mirrors the JSON structure published by the Python backend.
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

// BroadcastFunc is the function signature for broadcasting to the hub.
type BroadcastFunc func(data []byte)

func scoreChannel() string {
	channel := os.Getenv("REDIS_CHANNEL_LIVE_SCORES")
	if channel == "" {
		log.Printf("REDIS_CHANNEL_LIVE_SCORES not configured")
		return ""
	}
	return channel
}

// NewRedisClient creates a pre-configured Redis client.
func NewRedisClient() *redis.Client {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		log.Fatalf("REDIS_URL is not configured")
	}

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Failed to parse Redis URL: %v", err)
	}

	return redis.NewClient(opt)
}

// SubscribeToScores listens to the Redis pub/sub channel and calls broadcastFn
// with each message. It reconnects automatically on failure.
func SubscribeToScores(ctx context.Context, rdb *redis.Client, broadcastFn BroadcastFunc) {
	channel := scoreChannel()
	if channel == "" {
		log.Printf("Redis live score subscription disabled because no channel is configured")
		return
	}

	for {
		sub := rdb.Subscribe(ctx, channel)
		ch := sub.Channel()

		log.Printf("Subscribed to Redis channel: %s", channel)

		for msg := range ch {
			var score ScoreMessage
			if err := json.Unmarshal([]byte(msg.Payload), &score); err != nil {
				log.Printf("Invalid score message: %v", err)
				continue
			}

			broadcastFn([]byte(msg.Payload))
		}

		sub.Close()
		log.Printf("Redis subscription lost, reconnecting in 3s...")
		time.Sleep(3 * time.Second)
	}
}
