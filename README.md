# SportSync

SportSync is a real-time multi-sport web application for following live games, saved teams, highlights, standings, and matchup predictions in one place.

Live production site:

- [https://onsportsync.com](https://onsportsync.com)

## Current Scope

SportSync currently supports:

- NFL
- NBA
- MLB
- NHL
- EPL

Core product areas:

- Email/password auth and Google sign-in
- Personalized dashboard with saved teams
- Live scores and activity feed
- Team pages, standings, and game detail views
- ML-powered win probability predictions
- Password reset with 6-digit verification codes

## Tech Stack

### Frontend

- React
- TypeScript
- Tailwind CSS
- Axios
- React Query
- Recharts

### Backend

- FastAPI
- Python
- SQLAlchemy
- Alembic
- PostgreSQL
- Redis

### Realtime

- Go
- Gin
- Gorilla WebSocket

### ML

- scikit-learn
- Pandas
- NumPy

### Infrastructure

- Docker
- Docker Compose
- Nginx
- GitHub Actions
- AWS EC2
- AWS S3
- Amazon SES

## Architecture

SportSync runs as a small multi-service stack:

| Service | Responsibility |
| --- | --- |
| `frontend` | React app for the full user experience |
| `backend` | FastAPI REST API, auth, data logic, ML endpoints |
| `realtime` | Go WebSocket service for live score updates |
| `postgres` | Primary application database |
| `redis` | caching, rate limiting, sessions, pub/sub |
| `nginx` | reverse proxy, HTTPS, security headers |

FastAPI and Go do not call each other directly. Redis is the bridge for live score publishing.

## Local Development

### Prerequisites

- Node.js 20+
- Python 3.11+
- Go 1.21+
- Docker Desktop

### 1. Create environment files

Copy the root example file and fill in the values you need:

```bash
cp .env.example .env
```

For frontend-only local overrides, create `frontend/.env.development` if needed.

### 2. Start the local services

```bash
docker compose up -d
```

### 3. Run database migrations

```bash
cd backend
alembic upgrade head
```

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

### 5. Start the backend directly (optional)

If you want to run the FastAPI app outside Docker:

```bash
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

## Default Local URLs

| Service | URL |
| --- | --- |
| Frontend | [http://localhost:5173](http://localhost:5173) |
| Backend API | [http://localhost:8000](http://localhost:8000) |
| Realtime WS | `ws://localhost:8080/ws/scores` |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |

## Production Notes

Production currently runs on:

- `onsportsync.com`
- HTTPS via Let's Encrypt
- Docker Compose on AWS EC2

Important production services:

- Google OAuth
- AWS S3 for asset/object storage
- Amazon SES for transactional email

## Repository Structure

```text
SportSync/
  backend/                  FastAPI API service
  frontend/                 React application
  realtime/                 Go WebSocket service
  nginx/                    Nginx config
  backend/tests/            Pytest suite
  frontend/e2e/             Playwright tests
  .github/workflows/        CI/CD workflows
  docker-compose.yml
  docker-compose.prod.yml
  .env.example
```

## Testing

Backend tests:

```bash
pytest backend/tests -q
```

Frontend production build:

```bash
cd frontend
npm run build
```

Realtime tests:

```bash
cd realtime
go test ./...
```

## License

Personal engineering project by Louis Do. All rights reserved.
