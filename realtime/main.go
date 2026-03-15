/*
SportSync Realtime Service - Entry Point

Starts the Gin HTTP server with the WebSocket endpoint,
initializes the Hub for managing connections, and starts
the Redis subscriber for live score updates.
*/
package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"sportsync-realtime/handlers"
	redisclient "sportsync-realtime/redis"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Initialize WebSocket hub and start event loop
	hub := handlers.NewHub()
	go hub.Run()

	// Initialize Redis client and subscribe to score updates
	rdb := redisclient.NewRedisClient()
	ctx := context.Background()
	go redisclient.SubscribeToScores(ctx, rdb, func(data []byte) {
		hub.Broadcast(data)
	})

	// Set up Gin router
	router := gin.Default()

	// Health check endpoint for Docker and load balancer
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":      "healthy",
			"connections": hub.ConnectedCount(),
		})
	})

	// WebSocket endpoint for live score streaming
	router.GET("/ws/scores", handlers.HandleWebSocket(hub))

	log.Printf("Realtime service starting on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
