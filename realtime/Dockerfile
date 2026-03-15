# SportSync Realtime Service
# Go Gin WebSocket server for live score streaming

FROM golang:1.22-alpine

# Run as non-root user for security
RUN addgroup -S sportsync && adduser -S sportsync -G sportsync

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o bin/realtime .

# Switch to non-root user before running
USER sportsync

EXPOSE 8080

CMD ["./bin/realtime"]
