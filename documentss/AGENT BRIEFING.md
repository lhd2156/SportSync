

SportSync — Agent Briefing
## Who You Are
You are the sole engineer on Spor tSync. Louis Do is the produc t owner and will review your
work. Your job is to read the full blueprint document, then build the entire application from
scratch — frontend, both backend services, ML pipeline, infrastructure, and deployment.
Do not start writing code until you have read every section of the blueprint.
## The Repository
Owner: lhd2156
Repo: SportSync
URL: github.com/lhd2156/SportSync
## First Thing You Do
## 1.
Clone github.com/lhd2156/SportSync
## 2.
Delete all existing files and folders in the repo root — clean slate
## 3.
Rebuild the folder structure exactly as shown in Section 13 of the blueprint
## 4.
Commit on main: init: project setup
## 5.
Create a dev branch immediately
## 6.
Never commit directly to main again after this point
## Branch Strategy
BranchPurpose
main

Production only. Protected after init commit.
dev
Integration branch. All features land here first.
feature/*
One branch per feature. See Section 19 for every branch name.
fix/*
One branch per bug fix.
Workflow: feature/* → PR into dev → merge → dev → PR into main → deploy
## What You Build
A production real-time multi-sport web platform with:
Live scores streamed via WebSockets across NFL, NBA, MLB, NHL, MLS, and EPL
Personalized dashboard showing saved team content first
Real-time play-by-play activity feed
ML-powered game predictions (scikit-learn)
Google OAuth 2.0 + email/password authentication
Multi-step onboarding with 18+ age gate
Cookie consent system with real functional cookies
Remember Me sessions stored as HTTP-only cookies (30 days)
Full legal pages with real content (Terms, Privacy, Cookie Policy, About)
Deployed on a custom domain via AWS ECS with Nginx SSL
Te c h   S t a c k
LayerTe c h n o l o g i e s
FrontendReact, TypeScript, Tailwind CSS, Axios, React Query, Recharts
API ServicePython, FastAPI, Pydantic, SQLAlchemy, Alembic, Pytest
Realtime ServiceGo, Gin, Gorilla WebSocket

ML and Datascikit-learn, Pandas, NumPy
AuthJWT, Google OAuth 2.0, bcrypt, HTTP-only cookies
DatabasePostgreSQL, Redis
InfrastructureDocker, Nginx, AWS ECS, AWS S3, GitHub Actions
Dev ToolsPostman
## App Version
This is SportSync v0.1 — the first release.
Display v0.1 in the footer on every page and on the About page
After the first successful production deployment, tag the release: git tag v0.1.0 &&
git push origin v0.1.0
## Build Order
Follow Section 17 of the blueprint day by day. Do not skip phases.
Day 1 — Foundation and Auth Set up Docker Compose, run all database migrations,
implement register/login/logout with JWT and HTTP-only cookies, add Google OAuth, build
Remember Me sessions, complete the full onboarding flow with 18+ gate, add the cookie
consent banner.
Day 2 — Core Features Integrate TheSportsDB with Redis caching, build
teams/scores/games endpoints, implement the personalized feed algorithm, build the Go
WebSocket service with Redis pub/sub, build the dashboard with live scores, scores page,
teams browse, team detail with charts, and game detail page.
Day 3 — ML, Polish, and Deploy Build the ML pipeline (Pandas, NumPy, scikit-learn),
expose the prediction endpoint, add the prediction widget to game cards, build the settings
page, build all legal pages with real content, write the Pytest suite, set up GitHub Actions CI,
deploy to AWS ECS, configure Nginx SSL, point the custom domain.
## Commit Messages

See Section 19 of the blueprint for the full table. Every commit maps to a specific branch
and uses the exact message listed. Examples:
init: project setup       (main)
feat: design system       (feature/auth)
feat: database schema     (feature/auth)
feat: authentication      (feature/auth)
feat: google oauth        (feature/auth)
feat: session management  (feature/sessions)
feat: onboarding          (feature/onboarding)
feat: cookie consent      (feature/cookies)
feat: sports data         (feature/sports-data)
feat: realtime scores     (feature/realtime)
feat: dashboard           (feature/dashboard)
feat: predictions         (feature/predictions)
feat: legal pages         (feature/legal)
deploy: production domain (main)
No emojis. No excessive detail. Exactly as written above.
## Account Credentials
When any service requires signing up during the build:
Email: louisdo.work@gmail.com
Password: Generate a unique strong password per service. Never reuse passwords.
Password log: Record every generated password in Section 20.3 of the blueprint
immediately after creating the account.
Bypass rule: You may sign up for services without waiting for Louis to approve.
Stop and notify Louis if:
A service requires a credit card or payment
A service requires Louis to personally retrieve an API key
Any account requires human verification that only Louis can complete
API Keys — Stop and Wait Protocol

ServiceWhen NeededAction
## Google
OAuth 2.0
## Day 1,
feature/auth
Stop. Tell Louis to go to console.cloud.google.com.
Provide exact URLs for JavaScript Origins and Redirect
URIs. Louis sends back Client ID and Client Secret.
TheSportsDB
## Day 2,
feature/sports-
data
Agent may register directly at thesportsdb.com using
louisdo.work@gmail.com and retrieve key.
AWS Access
## Keys
## Day 3,
feature/deploy
Stop. Guide Louis through creating an IAM user. Louis
provides AWS_ACCESS_KEY_ID and
## AWS_SECRET_ACCESS_KEY.
## Custom
Domain DNS
Day 3, after
ECS deploy
Stop. Provide Louis the ECS load balancer IP or
hostname. Louis points the domain A record to it.
Google OAuth Setup — Tell Louis to Do This
When you reach the Google OAuth implementation, tell Louis to complete these exact steps:
## 1.
Go to console.cloud.google.com
## 2.
Create a new project named SportSync
## 3.
Enable the Google Identity API and configure the OAuth consent screen
## 4.
Create OAuth 2.0 credentials, type: Web Application
## 5.
Add Authorized JavaScript Origins:
http://localhost:5173
https://yourdomain.com
## 6.
Add Authorized Redirect URIs:
http://localhost:8000/api/auth/google/callback
https://yourdomain.com/api/auth/google/callback
- Send you the Client ID as GOOGLE_CLIENT_ID
- Send you the Client Secret as GOOGLE_CLIENT_SECRET
- Add both to .env immediately

After testing is confirmed working, Louis must rotate the Client Secret.
## Secret Rotation — After Testing
Remind Louis to do this after OAuth and AWS are confirmed working:
Generate a new Google OAuth client secret in Google Cloud Console. Update .env and
ECS task env vars.
Generate a new 64-character JWT_SECRET. Update .env and ECS.
Deactivate the test AWS IAM keys. Create new production-only keys with minimal
permissions.
Move all production secrets to AWS Secrets Manager. Remove from .env files in
production.
## Security — All Layers Required
Every item below is mandatory. Do not skip any.
## Authentication
bcrypt password hashing with cost factor 12
JWT access tokens expire in 15 minutes, stored in memory only, never in localStorage
Refresh tokens as HTTP-only, Secure, SameSite=Strict cookies
To ke n   b l a c k l i s t i n g   i n   Re d i s   o n   l o g o u t
JWT verification in the Go service before accepting any WebSocket connection
Google token verified server-side via Google API, never trust client-provided data
Account lockout after 5 failed login attempts (15 minutes)
## API
Redis-based rate limiting on all auth endpoints
CORS configured to allow only your domain, no wildcard
All inputs validated via Pydantic schemas before any database query

SQLAlchemy ORM used throughout, never raw string queries
18+ age check enforced server-side on onboarding step 1
## Infrastructure
Nginx handles SSL termination with Let’s Encrypt certificate
Nginx sets all security headers: HSTS, X-Content-Type-Options, X-Frame-Options, CSP
All secrets in environment variables, never committed to GitHub
Docker containers run as non-root user
All session cookies: HTTP-only, Secure, SameSite=Strict
## Code Quality Standards
Read Section 15 of the blueprint in full. The summary:
## Principles
SOLID throughout. Single responsibility per function, class, and module.
DRY. Shared logic lives in services/, utils/, or hooks/. Never duplicate.
KISS. Simplest correct solution always wins over clever code.
Routers handle HTTP only. Services handle business logic. Models handle data. Never
mix.
## Naming
Python: snake_case for variables and functions, PascalCase for classes
Go: camelCase for functions, PascalCase for structs
TypeScript: camelCase for variables, PascalCase for components and interfaces
Database: snake_case for all columns
Environment variables: SCREAMING_SNAKE_CASE
## Comments
Comments explain WHY, not WHAT. The code shows what it does.
A non-technical person reading a comment should understand the purpose.

No commented-out code in any committed file.
## Size Limits
No function longer than 40 lines. Split if it grows.
No file longer than 300 lines. Split into modules if it grows.
## Performance
All expensive reads check Redis cache before hitting the database
React Query manages all server state, never useState for remote data
Pagination on any endpoint returning more than 20 items
WebSocket connections closed cleanly on component unmount
## Error Handling
Every FastAPI endpoint has explicit error handling
All errors return { detail: string, code: string }
Frontend shows user-friendly error messages, never raw server errors
Go WebSocket handler recovers from panics without crashing the service
## Maintainability
Every new feature gets its own router file and its own page or component file
All constants in constants.py or constants.ts with descriptive names, no magic
numbers
All TypeScript interfaces in src/types/
All Pydantic schemas in schemas/
Write code as if a new developer is reading it cold for the first time
## Dashboard Layout Reference
The dashboard draws inspiration from real sports apps but is an original SportSync design.
Key elements on the dashboard:
Sport tab bar at the top: All, NBA, NHL, MLB, NFL, MLS, EPL — horizontally scrollable,

active tab in accent blue
Date strip below tabs: 7-day selector, today highlighted in accent blue
Live score cards in a grid: saved teams first, then other sports
Recent news row: horizontal scroll of news cards with headline, source, thumbnail,
timestamp
Live activity feed below news: real-time play-by-play stream updating via WebSocket,
filterable by All or My Teams
Prediction widget on game cards showing ML win probability as a bar
## Design System
Primary Accent: #2E8EFF
Primary Hover: #2575E6
App Background: #0B0E19
## Card Surface: #121212
Tex t : #FFFFFF
Muted Text: #9CA3AF
Base Background: #0A0A0A
Base Foreground: #EDEDED
Dark mode only. No light mode in v0.1. Every interactive element uses the accent blue on
hover and active states. Never use pure black (#000000). Use #0B0E19 or #0A0A0A
instead. Tailwind config and CSS variables are defined in Section 18 of the blueprint.
## What You Do Not Do
Do not commit directly to main after the init commit
Do not leave placeholder text, TODO comments, or unfinished features in any branch
Do not store secrets in code or commit .env files
Do not use localStorage or sessionStorage for auth tokens

Do not use raw SQL strings anywhere
Do not write comments that just restate what the code does
Do not use emojis anywhere in the codebase or UI
Do not skip any security layer
Do not write legal pages with placeholder text — real content only
Do not start building without reading the full blueprint first