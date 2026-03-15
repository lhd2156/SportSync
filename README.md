# SportSync

A production-grade real-time multi-sport web platform delivering live scores, personalized feeds, and ML-powered game predictions across NFL, NBA, MLB, NHL, MLS, and EPL.

## Version

v0.1 -- The start of a new beginning.

## Architecture

SportSync uses a microservices architecture with two independent backend services communicating through a shared Redis layer.

| Service | Tech | Responsibility |
|---------|------|---------------|
| API Service | Python + FastAPI | Auth, REST API, ML predictions, data logic |
| Realtime Service | Go + Gin | WebSocket connections, live score streaming |
| Cache / Broker | Redis | Shared cache, pub/sub, sessions, rate limiting |
| Gateway | Nginx | Reverse proxy, SSL termination, security headers |
| Frontend | React + TypeScript | Single-page application, Tailwind CSS |
| Database | PostgreSQL | Persistent data storage |

## Tech Stack

TypeScript, Python, Go, PostgreSQL, Redis, Docker, Nginx, AWS ECS, AWS S3, GitHub Actions, JWT, Google OAuth 2.0, scikit-learn, Pandas, NumPy, FastAPI, Gin, SQLAlchemy, Alembic, Pytest, React, Tailwind CSS, Axios, React Query, Recharts.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 18+
- Python 3.11+
- Go 1.21+

### Local Development

```bash
# Copy environment template and fill in values
cp .env.example .env

# Start all services
docker-compose up -d

# Run database migrations
cd backend && alembic upgrade head

# Start frontend dev server
cd frontend && npm install && npm run dev
```

### Services

| Service | Local URL |
|---------|----------|
| Frontend | http://localhost:5173 |
| API (FastAPI) | http://localhost:8000 |
| WebSocket (Go) | ws://localhost:8080 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production only. Protected after init commit. |
| `dev` | Integration branch. All features land here first. |
| `feature/*` | One branch per feature. |
| `fix/*` | One branch per bug fix. |

Workflow: `feature/*` -> PR into `dev` -> merge -> `dev` -> PR into `main` -> deploy

## Project Structure

```
sportsync/
  backend/          # Python FastAPI service
  realtime/         # Go Gin WebSocket service
  frontend/         # React TypeScript application
  nginx/            # Reverse proxy and SSL config
  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  .github/workflows/
```

## License

Personal engineering project by Louis Do. All rights reserved.

(c) 2026 SportSync
