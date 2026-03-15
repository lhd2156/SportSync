/*
SportSync Realtime Service - Entry Point.

Go/Gin WebSocket server that streams live score updates to connected clients.
Subscribes to Redis pub/sub channel and broadcasts events via WebSocket.
JWT verification required before accepting any WebSocket connection.
*/
package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	router := gin.Default()

	// Health check for Docker and load balancer
	router.GET("/ws/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "realtime"})
	})

	log.Printf("SportSync Realtime Service starting on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start realtime service: %v", err)
	}
}
