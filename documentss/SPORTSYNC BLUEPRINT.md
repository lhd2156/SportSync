

SportSync — Full Agent Blueprint
Ve r s i o n :   0.1
## Project: Personal Engineering Project
## Owner: Louis Do
GitHub: github.com/lhd2156/SportSync
SECTION 0 — Agent Mission
You are the sole engineer on Spor tSync. Louis Do is the produc t owner and will review your
work. Your job is to read this entire document before writing a single line of code, then build
the complete application from scratch on the existing GitHub repo.
Repo: github.com/lhd2156/SportSync
First task:
## 1.
Clone github.com/lhd2156/SportSync
## 2.
Delete ALL existing files and folders — clean slate
## 3.
Rebuild folder structure exactly as shown in Section 13
## 4.
Commit on main: init: project setup
## 5.
Create a dev branch immediately
## 6.
Never commit directly to main again after this
Branch workflow: feature/* → PR into dev → merge → dev → PR into main → deploy
## Rules:
Write every line of code — frontend, both backends, ML pipeline, Docker, Nginx, CI/CD
Te s t   e ve r y   fe a t u re   b e fo re   m a r k i n g   c o m p l e t e .   N e ve r   p u s h   b ro ke n   c o d e .

Create a commit at every milestone listed in Section 19
Every feature lives on its own branch — commit history must be clean and readable
Apply the color palette from Section 18 to every frontend component from day one
Never leave placeholder text, TODO comments, or unfinished features in any branch
Security is non-negotiable — every layer in Section 12 must be fully implemented
Legal pages must contain real substantive content — no placeholder legal text
No emojis anywhere in the codebase or UI
Follow Section 15 code quality standards on every file
Start: Clone repo → clean out → rebuild structure → create dev branch → feature/auth →
feature/onboarding → continue per Section 17
SECTION 1 — Project Overview
SportSync is a production-grade real-time multi-sport web platform deployed on a custom
domain. It is a personal engineering project — not affiliated with any institution.
Users register via email/password or Google OAuth 2.0, complete a personalized onboarding
flow selecting their favorite sports and teams, and receive a fully personalized dashboard of
live scores, standings, stats, a real-time play-by-play activity feed, and ML-powered game
predictions. Their saved team content always appears first.
The platform is built as a microservices architecture: a Python/FastAPI service for REST,
auth, ML, and data logic, and a Go/Gin service for all real-time WebSocket connections.
Both share a Redis layer for caching, pub/sub, and session management. The frontend is
React/TypeScript with a dark-mode-first design system.
This is version 0.1 — the start of the project. It is designed for maintainability, extensibility,
and production readiness from day one.
SECTION 2 — Final Tech Stack
Vague (languages and core programs only): TypeScript, Python, Go, CSS, PostgreSQL,
Redis, Docker, Nginx, AWS, GitHub Actions, Postman, JWT, scikit-learn, Pandas, NumPy
## Detailed:

LayerTe c h n o l o g i e s
FrontendReact, TypeScript, Tailwind CSS, Axios, React Query, Recharts
API ServicePython, FastAPI, Pydantic, SQLAlchemy, Alembic, Pytest
Realtime ServiceGo, Gin, Gorilla WebSocket
ML and Datascikit-learn, Pandas, NumPy
AuthJWT, Google OAuth 2.0, bcrypt, HTTP-only cookies
DatabasePostgreSQL, Redis
InfrastructureDocker, Nginx, AWS ECS, AWS S3, GitHub Actions
Dev ToolsPostman
SECTION 3 — System Architecture
SportSync uses a microservices architecture. Two independent backend services
communicate through a shared Redis layer. Nginx is the single entry point routing traffic by
path prefix. All services run in Docker containers — Docker Compose locally, AWS ECS in
production.
Client Browser (React + TypeScript)
## |
Nginx  -- Single entry point. Custom domain + SSL terminate here.
/api/*  -->  FastAPI (Python)        /ws/*  -->  Go + Gin
## |                                       |
REST + ML                            WebSocket Server
Auth + DB                            Live Score Stream
## Feed Algorithm                       High Concurrency
## |                                       |
PostgreSQL                          Redis Pub/Sub
(users, teams,                (score events broadcast
games, predictions,           to all connected WS clients)
sessions)                              |
## |                                   |
## Redis Cache  <------------------------> Redis Cache
(API responses, feed order,
rate limit counters, cookie sessions)

Service responsibilities:
ServiceTe c hOwns
## API
## Service
## Python
## +
FastAPI
Auth (JWT + OAuth + cookies), user data, teams, games, predictions,
ML pipeline, personalized feed, TheSportsDB integration, Redis
caching, rate limiting, security middleware
## Realtime
## Service
## Go +
## Gin
WebSocket connections, JWT verification, Redis pub/sub
subscription, broadcasts live score events to all connected clients
## Cache
and
## Broker
## Redis
Shared between services. API response cache, feed order per user,
pub/sub for scores, rate limit counters, Remember Me session tokens
GatewayNginx
Reverse proxy. Routes /api/* to FastAPI, /ws/* to Go. Serves React
static build. SSL termination. Security headers.
SECTION 4 — Authentication and Onboarding Flows
SportSync supports two registration paths: standard email/password and Google OAuth 2.0.
Both paths converge into the same mandatory multi-step onboarding flow. All users must
complete onboarding before accessing the main app. Sessions are managed with HTTP-
only cookies and JWT. Remember Me extends session to 30 days.
## Standard Registration
## Page: /register
Fields: email, password, confirm_password
Frontend validation: password match, email format, password strength
POST /api/auth/register
## Backend:
- Validate email not already taken
- Hash password with bcrypt (cost factor 12)
- Create user record (is_onboarded: false)
- Issue JWT (15 min access token)
- Set HTTP-only cookie with refresh token (7 days)
Redirect to /onboarding/step-1
Google OAuth 2.0

Page: /register or /login
User clicks Continue with Google button
Google OAuth popup opens
Google returns: email, name, google_id, profile_picture
POST /api/auth/google  { google_token }
## Backend:
- Verify Google token via Google API
- If new user: create account (password: null), is_onboarded: false
- If existing user: log in directly
- Issue SportSync JWT access token (15 min)
- Set HTTP-only cookie with refresh token
New user:      Redirect to /onboarding/step-1
Existing user: Redirect to /dashboard
Login with Remember Me
## Page: /login
Fields: email, password, remember_me (checkbox)
POST /api/auth/login  { email, password, remember_me }
## Backend:
- Verify email exists
- bcrypt compare password
- If remember_me = false: JWT expires 15 min, refresh cookie 7 days
- If remember_me = true:  JWT expires 15 min, refresh cookie 30 days
Store session token in Redis: session:{token} = user_id, TTL 30 days
- Set HTTP-only cookie: refresh_token, SameSite=Strict, Secure=true
Redirect to /dashboard (if onboarded) or /onboarding/step-1
NOTE: Remember Me = 30 day session stored as HTTP-only cookie + Redis session token.
Never stored in localStorage.
Onboarding Flow (ALL New Users — Email and Google)
NOTE: Mandatory for every new user. Users cannot access /dashboard until is_onboarded =
true. ProtectedRoute component enforces this on every frontend route.
STEP 1: /onboarding/step-1  --  Personal Info
Required: Date of Birth --> 18+ enforced BOTH frontend AND backend
## Required: Display Name
Optional: Gender (Male / Female / Non-binary / Prefer not to say)
Optional: Profile picture (Google users auto-filled from Google account)
POST /api/auth/onboarding/step-1
Backend: calculate age server-side. If < 18 return HTTP 403.

STEP 2: /onboarding/step-2  --  Pick Your Sports
Large selectable sport cards: NFL, NBA, MLB, NHL, MLS, Premier League
Must select at least 1. Multiple allowed.
POST /api/auth/onboarding/step-2  { sports: string[] }
Minor leagues (G League, XFL) = v2 feature, not in v1.
STEP 3: /onboarding/step-3  --  Pick Favorite Teams
Teams filtered by sports selected in Step 2
Each card: team logo, name, city, league
Must select at least 1 team.
POST /api/auth/onboarding/complete  { team_ids: string[] }
Backend: set is_onboarded = true
Redirect to /dashboard
Password for Google Users
Google users have no password on initial registration (password field is NULL)
Settings > Security shows: Add a password to enable email login if no password set
POST /api/auth/set-password allows Google users to set a password
Once set, they can log in via email/password OR Google — both work
## 18+ Age Validation
LayerValidationResponse if Under 18
## Frontend
Calculate age from DOB in real-time,
disable Continue button if under 18
Show inline error: You must be
18 or older
## Backend
Server-side age calculation on POST
## /api/auth/onboarding/step-1
Return HTTP 403 with error
message, do not proceed
SECTION 5 — Cookies, Sessions, and Remember Me
SportSync uses real functional cookies — not just for compliance. Cookie consent banner is
shown to all new visitors before any non-essential cookies are set.
## Cookie Consent Banner
Trigger: First visit to any page (before login)
Position: Fixed bottom of screen, full width

## Content:
SportSync uses cookies to keep you logged in and improve your experience.
By continuing, you agree to our Cookie Policy.
Buttons: [Accept All]  [Manage Preferences]
## On Accept All:
- Set cookie: cookie_consent=true, expires 1 year, SameSite=Strict
- Banner dismissed, never shown again on this device
## On Manage Preferences:
- Modal opens showing cookie categories:
- Essential (always on, cannot disable) -- auth sessions, security
- Functional (on by default) -- Remember Me, preferences
- Analytics (off by default) -- usage tracking if added later
- User saves preferences, stored in cookie: cookie_prefs={json}
Cookies SportSync Actually Uses
Cookie NameTypeExpires
## HTTP-
## Only
## Purpose
refresh_tokenEssential
7 or 30
days
## Yes
JWT refresh token. 30 days if
Remember Me checked.
cookie_consentEssential1 yearNo
Records that user accepted cookie
banner
cookie_prefsEssential1 yearNoUser cookie category preferences
session_tokenFunctional
## 30
days
## Yes
Remember Me long session. Stored
in Redis.
ui_prefsFunctional
## 6
months
NoTheme and sport filter preferences
SECURITY: refresh_token and session_token MUST be HTTP-only, Secure, SameSite=Strict.
Never accessible via JavaScript. Never stored in localStorage or sessionStorage.
## Remember Me Technical Implementation
On login with remember_me=true:
- Generate cryptographically random session token (secrets.token_urlsafe(32))
- Store in Redis: session:{token} = user_id, TTL = 2592000 (30 days)
- Set HTTP-only cookie: session_token={token}, Max-Age=2592000

SECTION 6 — Personalization and Feed Algorithm
Every feed in SportSync is personalized based on the user’s saved teams and selected
sports.
## Feed Priority Order
Priority 1 -- User's saved teams (always first)
Live scores for saved teams --> top of dashboard
Upcoming games for saved teams --> before other games
ML predictions for saved teams --> surfaced prominently
Priority 2 -- Same league / same sport as saved teams
If user follows Lakers (NBA) --> show other NBA games next
Same division teams prioritized within this tier
Priority 3 -- Other sports user selected in onboarding
Sports they follow but have no saved teams in
Priority 4 -- Everything else (Explore section)
All other league content, shown last or in separate Explore tab
Redis Caching for Personalization
On login: compute user feed order, cache as feed:{user_id}, TTL 5 minutes
On save/unsave team: invalidate feed:{user_id} cache immediately
TheSportsDB live scores cache: TTL 2 minutes
- Also issue short-lived JWT (15 min) for API calls
On subsequent visits:
- JWT expired --> client sends refresh request with refresh_token cookie
- Backend verifies refresh_token, checks session still valid in Redis
- If valid: issue new JWT access token (15 min)
- If Redis session expired: force re-login
On logout:
- Delete session:{token} from Redis immediately
- Clear all auth cookies (set Max-Age=0)
- Blacklist current JWT in Redis until it naturally expires

TheSportsDB standings/rosters cache: TTL 1 hour
Te a m   d a t a   c a c h e :   T T L   6   h o u r s
Supported Sports v1
SportLeagueStatus
FootballNFLIncluded
BasketballNBAIncluded
BaseballMLBIncluded
HockeyNHLIncluded
SoccerMLS + EPLIncluded
BasketballG Leaguev2 post launch
FootballXFLv2 post launch
SECTION 7 — Database Schema (PostgreSQL)
## Users Table
ColumnTypeNotes
idUUIDPrimary key, auto-generated
emailVARCHAR(255)Unique, required, lowercase stored
hashed_passwordVARCHAR
Nullable — Google users have no password
initially
google_idVARCHARNullable — only set for Google OAuth users
display_nameVARCHAR(100)Required, set during onboarding step 1
date_of_birthDATERequired, 18+ enforced server-side
genderVARCHAR(50)Nullable, optional during onboarding
profile_picture_urlVARCHARNullable, auto-filled from Google if OAuth user

is_onboardedBOOLEANDefault false. Must be true to access dashboard.
failed_login_attemptsINTEGERDefault 0. Locked after 5 failed attempts.
locked_untilTIMESTAMPNullable. Account locked until this timestamp.
last_login_atTIMESTAMPUpdated on every successful login
created_atTIMESTAMPAuto-set on creation
Te a m s   Ta b l e
ColumnTypeNotes
idUUIDPrimary key
external_idVARCHARTheSportsDB team ID for API calls
nameVARCHAR(100)Full team name e.g. Los Angeles Lakers
short_nameVARCHAR(10)e.g. LAL
sportVARCHAR(50)NFL / NBA / MLB / NHL / Soccer
leagueVARCHAR(50)e.g. NBA, EPL, MLS
logo_urlVARCHARTe a m   l o g o   f ro m   T h e S p o r t s D B   o r   S 3
cityVARCHAR(100)Te a m   c i t y
## Other Tables
Ta b l eKey FieldsPurpose
user_teamsuser_id (FK), team_id (FK), saved_at
## Many-to-many. User
saved teams.
user_sportsuser_id (FK), sport VARCHAR
Sports user selected
during onboarding
games
id, home_team_id, away_team_id, sport, league,
scheduled_at, status, home_score, away_score
Game schedule, live
scores, results
id, game_id (FK), home_win_prob, away_win_prob,
ML model output per

predictionsmodel_version, created_atgame matchup
SECTION 8 — API Endpoints (FastAPI)
## Auth Endpoints
MethodEndpointRequestResponse
POST/api/auth/register
email, password,
confirm_password
access_token,
is_onboarded: false +
set cookies
POST/api/auth/login
email, password,
remember_me
access_token,
is_onboarded + set
cookies
POST/api/auth/googlegoogle_token
access_token,
is_onboarded,
is_new_user + set
cookies
POST/api/auth/refresh
## (reads
refresh_token
cookie)
New access_token
POST/api/auth/logout(reads cookies)
200 OK, clears all
cookies, deletes Redis
session
POST/api/auth/onboarding/step-1
date_of_birth,
display_name,
gender?,
profile_pic?
200 OK or 403 if
under 18
POST/api/auth/onboarding/step-2sports: string[]200 OK
POST/api/auth/onboarding/completeteam_ids: string[]
## 200 OK,
is_onboarded: true
POST/api/auth/set-password
password,
confirm_password
(auth required)
## 200 OK

Te a m s ,   S c o r e s ,   G a m e s ,   P r e d i c t i o n s
MethodEndpointDescription
GET/api/teams
All teams. Query: ?sport=NBA&league=NBA. Redis
cached.
GET/api/teams/{id}Te a m   d e t a i l ,   re c e n t   re s u l t s ,   ro s t e r,   s t a t s .   Re d i s   c a c h e d .
GET/api/scoresLive and recent scores. Redis cached TTL 2 min.
GET/api/gamesUpcoming and recent games. Query: ?sport=NFL
GET/api/games/{id}Single game with scores and prediction
GET/api/predict/{game_id}
ML win probability. Returns home_win_prob and
away_win_prob.
User Endpoints (Auth Required)
MethodEndpointDescription
GET/api/user/feed
Personalized dashboard feed. Saved teams first. Redis
cached.
GET/api/user/teamsUser saved teams list
POST/api/user/teams/{id}Save a team. Invalidates feed cache.
DELETE/api/user/teams/{id}Unsave a team. Invalidates feed cache.
GET/api/user/profileGet user profile
PUT/api/user/profileUpdate display name, gender, profile picture
WebSocket Endpoint (Go/Gin)
ws://[domain]/ws/scores?token={jwt}
Client connects passing JWT as query param
Go verifies JWT signature and expiry
Go subscribes to Redis channel: scores:live
FastAPI publishes score updates to scores:live when scores change
Go broadcasts JSON to all connected clients:
{ game_id, home_team, away_team, home_score, away_score, status, sport, league }
Client React component receives event, updates ScoreCard in real-time without refresh

SECTION 9 — Frontend Pages and Components
## All Routes
## Route
## Auth
## Required
## Description
/No
Landing page. CTA to register/login. Professional
marketing page.
/registerNo
Email/password form + Google OAuth button + legal
disclaimer
/loginNo
Email/password + Remember Me checkbox + Google
OAuth button
## /onboarding/step-
## 1
JWT only
DOB, display name, gender (optional), profile pic
## (optional)
## /onboarding/step-
## 2
JWT onlyPick sports (large cards)
## /onboarding/step-
## 3
JWT onlyPick favorite teams filtered by step 2 selections
## /dashboard
## Yes +
onboarded
Personalized feed. Live scores WebSocket. Saved
team highlights.
## /scores
## Yes +
onboarded
All live and recent scores across all sports via
WebSocket
## /teams
## Yes +
onboarded
Browse teams. Filter by sport and league.
## /teams/:id
## Yes +
onboarded
Te a m   s t a t s ,   ro s t e r,   re c e n t   g a m e s ,   Re c h a r t s
visualizations
## /games/:id
## Yes +
onboarded
Game detail + ML prediction widget
## /settings
## Yes +
onboarded
Profile edit, set password (Google users), sport
preferences

/termsNoTe r m s   o f   S e r v i c e   —   f u l l   l e g a l   c o n t e n t
/privacyNoPrivacy Policy — full legal content
/cookiesNoCookie Policy — explains all cookies used
/aboutNoAbout SportSync — clean, professional, shows v0.1
## Key Components
ComponentDescription
CookieBanner
Fixed bottom banner on first visit. Accept All and Manage
Preferences. Dismissed after consent set.
CookieModalPreference modal showing Essential / Functional / Analytics toggles.
ProtectedRoute
Wraps all auth-required routes. Redirects to /login if no JWT.
Redirects to /onboarding if not onboarded.
SportTabBar
Horizontal scrollable tab bar. Tabs: All, NBA, NHL, MLB, NFL, MLS,
EPL. Active tab in accent blue.
DateStrip
7-day horizontal date selector. Today highlighted in accent blue.
Click a date to filter games.
ScoreCard
Game card with team logos, names, scores, game status. Live games
show pulsing dot and period/time. Two-per-row grid on desktop, full-
width on mobile.
LiveBadge
Pulsing blue animated dot on all live game cards. Updates via
WebSocket.
LiveActivityFeed
Real-time play-by-play feed. Each item: player photo, play
description, score context, timestamp. Updates via WebSocket.
Filter: All or My Teams.
GameDetailHeader
Sticky header on game detail page. Teams, live score, period/time,
tabs: Feed / Game / Team A / Team B.
NewsCard
Recent sports news card. Headline, source, thumbnail, timestamp.
Displayed in horizontal scroll row on dashboard.
Te a m C a rd
Te a m   l o g o ,   n a m e ,   c i t y,   l e a g u e .   U s e d   i n   o n b o a rd i n g   a n d   t e a m s   b rows e
page.

SportSelectorOnboarding Step 2. Large selectable sport cards with sport icons.
PredictionWidget
ML win probability bar chart (Recharts). Shows home vs away win
percentage.
StatChartRecharts line/bar chart for team stats on team detail page.
OnboardingProgressStep 1/2/3 progress indicator shown at top of all onboarding pages.
GoogleAuthButton
Styled Google OAuth button following Google branding guidelines
exactly.
AgeGateInline error shown when DOB is under 18. Blocks form submission.
## Navbar
To p   n av.   Lo g o ,   s p o r t   t a b s ,   s e a rc h   i c o n ,   u s e r   ava t a r   d ro p d ow n ,   l o g o u t .
Hidden on onboarding.
## Footer
On ALL pages. Logo, nav links, legal links, 18+ notice, copyright, v0.1
version.
## Dashboard Layout
NOTE: Do not copy any real app. This is SportSync’s original design inspired by sports app
layout patterns.
## +---------------------------------------------+
|  Navbar  (logo | sport tabs | search | user) |
## +---------------------------------------------+
|  SportTabBar: All | NBA | NHL | MLB | NFL ... |
|  DateStrip:  Thu  Fri [Sat] Sun  Mon  Tue    |
## +---------------------------------------------+
|  LIVE SCORES  (saved teams first)            |
## |  +----------+ +----------+ +----------+      |
|  | ScoreCard| | ScoreCard| | ScoreCard|      |
|  |  LIVE    | |  7:30 PM | |  Final   |      |
## |  +----------+ +----------+ +----------+      |
## +---------------------------------------------+
|  RECENT NEWS  (horizontal scroll row)        |
|  [NewsCard] [NewsCard] [NewsCard] -->         |
## +---------------------------------------------+
|  LIVE ACTIVITY FEED  (play-by-play stream)   |
|  Filter: All games | My Teams                |
## |  +-------------------------------------------+|
|  | [photo]  Play description                 ||
|  |          Player - stat - score context    ||
|  |          timestamp                        ||

## |  +-------------------------------------------+|
|  (updates in real-time via WebSocket)        |
## +---------------------------------------------+
## |  Footer                                      |
## +---------------------------------------------+
## Game Detail Layout
## +---------------------------------------------+
|  <- Back  [Game1] [Game2] [Game3] scroll --> |
## +---------------------------------------------+
|  TeamLogo  72   - 11:39 4th   93  TeamLogo  |
## |  Team Name          Live         Team Name  |
## +---------------------------------------------+
|  Tabs: [Feed] [Game] [Team A] [Team B]       |
## +---------------------------------------------+
|  Feed tab: Live play-by-play activity        |
|  Game tab: Box score, stats breakdown        |
|  Team A tab: Roster, recent form, stats      |
|  Team B tab: Roster, recent form, stats      |
## |                                              |
|  ML Prediction Widget (Recharts bar)         |
## |  Home Win 63%  ########....  Away 37%        |
## +---------------------------------------------+
SECTION 10 — Legal, Compliance, and Professional Standards
SportSync must look and feel like a real production product at every touchpoint. Legal
pages must contain genuine substantive content — never placeholder text. Every page has a
professional footer.
Footer (Every Page)
SportSync logo and tagline on left
Nav links: Home, Scores, Teams, About
Legal links: Terms of Service, Privacy Policy, Cookie Policy
18+ notice: SportSync is intended for users 18 years of age and older.
Copyright: 2026 SportSync. All rights reserved.
Version: v0.1

## Legal Pages Required
PageMust Include
Te r m s
of
## Service
Eligibility (18+), user accounts, acceptable use, intellectual property, disclaimers,
limitation of liability, governing law, changes to terms, contact information
## Privacy
## Policy
What data we collect (email, DOB, gender, Google profile data), how we use it,
Google OAuth data handling, third-party services (TheSportsDB, AWS), data
retention, user rights, how to delete account, contact info
## Cookie
## Policy
All cookies listed matching Section 5 exactly, what each cookie does, how long it
lasts, HTTP-only explanation, how to opt out, link to manage preferences
AboutWhat SportSync is, mission, sports supported, contact email, version v0.1
Register and Login Legal
Below register form: By creating an account you agree to our Terms of Service and
Privacy Policy — both links clickable, open in new tab
18+ notice above the date of birth field on onboarding step 1
Google OAuth button must follow Google branding guidelines exactly
SECTION 11 — ML Prediction Pipeline
Python module inside the FastAPI service. Uses Pandas and NumPy to clean and transform
historical game data, trains a scikit-learn model, and exposes predictions via /api/predict.
## Step 1: Data Collection
Fetch historical game results from TheSportsDB for all supported leagues
Store in PostgreSQL games table
Step 2: Feature Engineering (Pandas + NumPy)
Load games into Pandas DataFrame
Engineer: home_win_rate, away_win_rate, head_to_head_record,
avg_points_scored, avg_points_allowed, recent_form (last 5 games)
NumPy for numerical normalization
## Step 3: Model Training (scikit-learn)
## Model: Random Forest Classifier
Target: home_team_wins (binary classification)

Train/test split: 80/20
Save model to disk: backend/ml/model.pkl (joblib)
## Step 4: Prediction Endpoint
GET /api/predict/{game_id}
Load model from disk (cache in memory after first load)
Build feature vector for the two teams from DB
Return: { home_win_prob: 0.63, away_win_prob: 0.37 }
Store in predictions table for history tracking
SECTION 12 — Security Layers (All Required)
Every item in this section is mandatory. Do not skip any security layer.
## Authentication Security
LayerImplementation
## Password
## Hashing
bcrypt with cost factor 12. Never store plaintext passwords. Never log
passwords.
JWT Access
To ke n s
Short-lived: 15 minute expiry. Signed with HS256. Never stored in
localStorage — in memory only.
## Refresh
To ke n s
HTTP-only, Secure, SameSite=Strict cookies only. 7 days standard, 30
days Remember Me.
To ke n
## Blacklisting
On logout: store current JWT in Redis blacklist until natural expiry. Check
blacklist on every protected request.
## JWT
Verification in
## Go
Go WebSocket service must verify JWT signature before accepting any
WebSocket connection.
## Google Token
## Verification
Verify Google ID token server-side via Google tokeninfo endpoint. Never
trust client-provided Google data directly.
## Account
## Lockout
After 5 failed login attempts: lock account for 15 minutes. Track in
users.failed_login_attempts and users.locked_until.
API Security

LayerImplementation
## Rate
## Limiting
Redis-based rate limiting on all auth endpoints. Login: 10 attempts per IP per 15
min. Register: 5 per IP per hour.
## CORS
FastAPI CORS middleware. Allow only specific origins (your domain). No
wildcard.
## Input
## Validation
All inputs validated via Pydantic schemas on every endpoint. Reject malformed
requests before any DB queries.
## SQL
## Injection
SQLAlchemy ORM prevents raw SQL injection. Never use string formatting for
queries.
## 18+ Age
## Gate
Server-side age calculation on /api/auth/onboarding/step-1. Return HTTP 403 if
under 18.
## Infrastructure Security
LayerImplementation
## HTTPS /
## SSL
Nginx handles SSL termination. Let’s Encrypt free certificate. HTTP traffic
redirected to HTTPS automatically.
## Security
## Headers
Nginx sets: Strict-Transport-Security, X-Content-Type-Options, X-Frame-
Options: DENY, X-XSS-Protection, Content-Security-Policy.
## Environment
## Variables
All secrets in .env files. .env in .gitignore. Never commit secrets to GitHub.
Use AWS Secrets Manager in production.
## Docker
## Security
Run containers as non-root user. Expose only necessary ports. No debug
ports in production.
## Cookie
## Security
All session cookies: HTTP-only=true, Secure=true, SameSite=Strict. Prevents
XSS token theft and CSRF attacks.
## CSRF
## Protection
SameSite=Strict on cookies provides CSRF protection. All state-changing
requests require valid JWT in Authorization header.
SECTION 13 — Folder Structure
sportsync/
├── backend/                        # Python FastAPI service

│   ├── main.py                     # FastAPI app entry point, middleware setup
│   ├── config.py                   # Pydantic settings, env vars
│   ├── database.py                 # SQLAlchemy engine and session factory
│   ├── dependencies.py             # get_current_user, rate_limit deps
│   ├── constants.py                # App-wide constants, no magic numbers
│   ├── routers/
│   │   ├── auth.py                 # register, login, google, refresh, logout, onboarding
│   │   ├── teams.py                # teams endpoints
│   │   ├── scores.py               # scores endpoints
│   │   ├── games.py                # games endpoints
│   │   ├── predictions.py          # ML prediction endpoint
│   │   └── user.py                 # profile, saved teams, feed
│   ├── models/                     # SQLAlchemy ORM models
│   │   ├── user.py
│   │   ├── team.py
│   │   ├── game.py
│   │   └── prediction.py
│   ├── schemas/                    # Pydantic request/response schemas
│   ├── services/                   # Business logic (routers call services, never raw DB)
│   │   ├── auth_service.py         # JWT, OAuth, bcrypt, cookies, sessions
│   │   ├── sports_api.py           # TheSportsDB integration
│   │   ├── feed_service.py         # Personalization algorithm
│   │   ├── cache_service.py        # Redis helpers
│   │   └── security_service.py     # Rate limiting, lockout, blacklist
│   ├── ml/                         # ML pipeline
│   │   ├── pipeline.py             # Data collection and feature engineering
│   │   ├── train.py                # Model training script
│   │   ├── predict.py              # Inference
│   │   └── model.pkl               # Saved model (gitignored)
│   ├── migrations/                 # Alembic migrations
│   └── tests/                      # Pytest
│       ├── test_auth.py
│       ├── test_teams.py
│       └── test_predictions.py
├── realtime/                       # Go Gin WebSocket service
│   ├── main.go
│   ├── handlers/
│   │   └── websocket.go            # WS handler and JWT verification
│   └── redis/
│       └── subscriber.go           # Redis pub/sub subscriber
├── frontend/
│   └── src/
│       ├── components/             # All reusable components
│       ├── pages/                  # All route pages
│       ├── hooks/                  # React Query hooks and useWebSocket
│       ├── api/                    # Axios client with JWT interceptor
│       ├── context/                # AuthContext, CookieContext

SECTION 14 — .gitignore
Place this in the repo root. It covers all services.
# Environment and Secrets
## .env
## .env.*
## !.env.example
## *.pem
## *.key
## # Python
## __pycache__/
## *.py[cod]
## *.so
## .venv/
venv/
dist/
build/
## *.egg-info/
## .pytest_cache/
## .mypy_cache/
htmlcov/
## .coverage
# ML Model (trained artifact, never commit)
backend/ml/model.pkl
backend/ml/*.pkl
backend/ml/*.joblib
## # Go
│       ├── utils/                  # Age validation, date formatters, helpers
│       ├── types/                  # All TypeScript interfaces (never inline)
│       └── constants.ts            # Frontend constants, no magic numbers
├── nginx/
│   └── nginx.conf                  # Reverse proxy, SSL, security headers
├── docker-compose.yml              # Local dev, all services
├── docker-compose.prod.yml         # Production overrides
├── .env.example                    # Template — never commit real .env
## ├── .gitignore
## └── .github/
└── workflows/
└── deploy.yml              # GitHub Actions CI/CD

realtime/bin/
realtime/*.exe
# Node and Frontend
node_modules/
frontend/dist/
frontend/build/
## .next/
## *.tsbuildinfo
## .eslintcache
## # Docker
docker-compose.override.yml
# OS and Editor
.DS_Store
## Thumbs.db
## .idea/
## .vscode/
## *.swp
## *.swo
## # Logs
## *.log
logs/
npm-debug.log*
## # AWS
## .aws/
## *.tfstate
## *.tfstate.*
# Alembic (keep migration scripts, only ignore temp files)
backend/migrations/__pycache__/
SECTION 15 — Code Quality and Engineering Standards
These standards apply to every single file written. No exceptions. SportSync is designed to
have many future versions — the code must be maintainable, readable, and extensible from
v0.1 forward.
## General Principles
Follow SOLID principles throughout — single responsibility, open/closed, dependency

injection where applicable
DRY — shared logic lives in services/, utils/, or hooks/. Never duplicate logic across files
KISS — the simplest correct solution is always preferred over clever code
Separation of concerns — routes handle HTTP, services handle business logic, models
handle data. Never mix these
Every function and module does one thing and does it well
## Naming Conventions
ContextConventionExample
Python variablessnake_case
user_feed, saved_team_ids,
home_win_probability
Python functionssnake_case
get_user_feed(), calculate_age(),
build_feature_vector()
Python classesPascalCase
UserService, CacheService,
FeedAlgorithm
Go functionscamelCase
handleScoreUpdate(),
subscribeToScores()
Go structsPascalCase
ScoreEvent, WebSocketClient,
RedisSubscriber
TypeScript
variables
camelCase
savedTeams, homeWinProbability,
isOnboarded
## React
components
PascalCase
ScoreCard, LiveActivityFeed,
SportTabBar
TypeScript
interfaces
PascalCase, no I prefix
User, Team, Game, ScoreEvent,
## Prediction
CSS / TailwindTa i l w i n d   t o ke n s   o n l y
bg-surface text-foreground hover:bg-
accent
API endpointskebab-case, plural nouns
## /api/teams, /api/games, /api/user/saved-
teams
## Database
columns
snake_case
date_of_birth, is_onboarded,
home_win_prob

## Environment
variables
## SCREAMING_SNAKE_CASE
## JWT_SECRET, GOOGLE_CLIENT_ID,
## REDIS_URL
Comments — Simple, Clear, Human-Readable
Comments explain WHY, not WHAT. The code itself shows what it does. A non-technical
person reading a comment should understand the purpose.
# Good — explains purpose a non-developer can understand
# Check if the user is old enough to use the app before saving their account
if calculate_age(date_of_birth) < 18:
raise HTTPException(status_code=403, detail="Must be 18 or older")
# Bad — just restates the code, adds no value
# Check if age is less than 18
if calculate_age(date_of_birth) < 18:
# Good — explains why a decision was made
# Cache the feed for 5 minutes so the dashboard stays fast under load.
# We invalidate early whenever the user saves or removes a team.
redis.setex(f"feed:{user_id}", 300, serialized_feed)
# Section headers in long files are fine for navigation
## # --- Authentication Routes ---
## # --- Feed Algorithm ---
No commented-out code in any committed file.
File and Function Size Limits
No function longer than 40 lines — split into smaller focused functions if it grows
No file longer than 300 lines — split into modules if it grows
No component with more than one primary responsibility — split if needed
Router files contain only route definitions — all logic lives in services/
## Performance Standards
All database queries use SQLAlchemy ORM — never raw string queries
All expensive reads check Redis cache before hitting the database
React components use React.memo() where re-renders would be expensive

React Query handles all server state — never use useState for remote data
Images served from S3 with correct cache headers — never embed large assets in the
bundle
WebSocket connections are closed cleanly on component unmount to prevent memory
leaks
Pagination required on any endpoint returning a list of more than 20 items
## Error Handling
Every FastAPI endpoint has explicit error handling — no unhandled exceptions reach the
client
All errors return consistent JSON: { "detail": "string", "code": "string" }
Frontend displays user-friendly error messages — never expose raw server errors to the
## UI
Go WebSocket handler recovers from panics gracefully without crashing the service
All Axios requests wrapped in try/catch with React Query error boundaries on the
frontend
## Maintainability Rules
Every new feature gets its own router file (backend) and its own page or component file
## (frontend)
No magic numbers — all constants live in constants.py or constants.ts with clear
descriptive names
All TypeScript interfaces live in src/types/ — never define types inline in component files
All Pydantic schemas live in schemas/ — never define request/response shapes inside
router files
The codebase must be understandable to a new developer reading it cold — write for
that person
SECTION 16 — Environment Variables
## Backend (.env)

DATABASE_URL=postgresql://user:password@localhost:5432/sportsync
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-key-min-32-chars
## JWT_ALGORITHM=HS256
## JWT_ACCESS_EXPIRE_MINUTES=15
## JWT_REFRESH_EXPIRE_DAYS=7
## JWT_REMEMBER_ME_EXPIRE_DAYS=30
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
SPORTSDB_API_KEY=your-thesportsdb-api-key
AWS_S3_BUCKET=sportsync-assets
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
CORS_ORIGINS=https://yourdomain.com
ENVIRONMENT=development
## Frontend (.env)
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8080
VITE_GOOGLE_CLIENT_ID=your-google-client-id
SECTION 17 — Build Order (2-3 Day Sprint)
Follow this order exactly. Do not skip phases. Each phase builds on the previous.
## Day 1 — Foundation, Auth, Cookies
## 1.
Initialize GitHub repo, folder structure, .gitignore, README
## 2.
Docker Compose: FastAPI, Go, PostgreSQL, Redis, Nginx all running and healthy
## 3.
Alembic migrations: all tables created
## 4.
FastAPI: security middleware (CORS, rate limiter, security headers)
## 5.
FastAPI: register, login, logout, refresh token endpoints (bcrypt, JWT, HTTP-only
cookies, Remember Me 30 days)
## 6.
FastAPI: Google OAuth endpoint (verify Google token server-side, issue JWT)
## 7.
FastAPI: onboarding step 1, 2, 3 endpoints (18+ server-side gate)
## 8.
React: AuthContext and Axios interceptor (auto-attach JWT, auto-refresh on 401)

## 9.
React: CookieBanner and CookieModal components
## 10.
React: /register, /login pages (Google OAuth button, Remember Me checkbox, legal
disclaimer)
## 11.
React: Onboarding Step 1, 2, 3 pages with AgeGate, OnboardingProgress,
ProtectedRoute
## Day 2 — Core Features
## 1.
FastAPI: TheSportsDB integration with Redis caching (all 5 sports)
## 2.
FastAPI: teams, scores, games endpoints
## 3.
FastAPI: personalized feed endpoint with priority algorithm and Redis caching
## 4.
FastAPI: save/unsave team endpoints with cache invalidation
## 5.
Go: WebSocket server with JWT verification and Redis pub/sub
## 6.
React: /dashboard with personalized feed, live WebSocket score updates, news row,
activity feed
## 7.
React: /scores page
## 8.
React: /teams browse with filters
## 9.
React: /teams/:id with Recharts stat charts
## 10.
React: /games/:id with game detail and tabs
Day 3 — ML, Polish, Security, Deploy
## 1.
Python: ML pipeline (Pandas feature engineering, NumPy, scikit-learn Random Forest
training)
## 2.
FastAPI: /api/predict endpoint
## 3.
React: PredictionWidget on game cards and game detail page
## 4.
React: /settings page (profile edit, set password for Google users)
## 5.
React: Landing page, About, Terms, Privacy, Cookie Policy (real content)
- React: Navbar, Footer (legal links, 18+ notice, v0.1) on all pages
## 7.
Security audit: verify all layers in Section 12 are implemented
## 8.
Pytest suite: auth, onboarding, teams, predictions, age gate

## 9.
GitHub Actions CI: run Pytest on every push to main
## 10.
AWS ECS and S3 deployment with docker-compose.prod.yml
## 11.
Nginx SSL config: Let’s Encrypt cert for custom domain
## 12.
DNS: point custom domain A record to AWS ECS load balancer
## 13.
Final QA: test all flows on production domain
## 14.
Ta g   r e l e a s e :  git tag v0.1.0 && git push origin v0.1.0
SECTION 18 — Color Palette and Design System
## Core Color Tokens
To ke nHexUsage
Primary Accent#2E8EFFButtons, links, active states, highlights, badges
Primary Hover#2575E6Button hover state, focus rings, interactive hover
App Background#0B0E19Main page background, body, layout wrappers
Card Surface#121212Cards, modals, dropdowns, score cards, team cards
Tex t#FFFFFFAll primary text, headings, labels
Muted Text#9CA3AFSubtitles, timestamps, placeholders, secondary icons
Base Background#0A0A0ADark mode base background fallback
Base Foreground#EDEDEDDark mode base foreground text fallback
Ta i l w i n d   C o n f i g
// tailwind.config.js
module.exports = {
theme: {
extend: {
colors: {
accent:     { DEFAULT: '#2E8EFF', hover: '#2575E6' },
background: { DEFAULT: '#0B0E19', base: '#0A0A0A' },
surface:    '#121212',

foreground: { DEFAULT: '#FFFFFF', base: '#EDEDED' },
muted:      '#9CA3AF',
## },
## },
## },
## }
CSS Variables (globals.css)
## :root {
--accent:          #2E8EFF;
--accent-hover:    #2575E6;
--background:      #0B0E19;
--background-base: #0A0A0A;
## --surface:         #121212;
--foreground:      #FFFFFF;
--foreground-base: #EDEDED;
--muted:           #9CA3AF;
## }
## Component Usage
ElementTa i l w i n d   C l a s s e s
Page backgroundbg-background
Cards and surfacesbg-surface
Primary buttonbg-accent hover:bg-accent-hover
Primary texttext-foreground
Muted texttext-muted
Accent texttext-accent
Bordersborder-surface or border-muted/20
Input fieldsbg-surface border-muted/30 text-foreground
Navbarbg-background border-b border-muted/20
Footerbg-surface border-t border-muted/20
LiveBadge dotbg-accent animate-pulse

Cookie bannerbg-surface border-t border-muted/20
## Design Principles
Dark mode only — no light mode toggle in v0.1
Every interactive element uses #2E8EFF accent on hover and active states
Cards always use #121212 surface against #0B0E19 background for visual depth
Never use pure black (#000000) — use #0B0E19 or #0A0A0A instead
White (#FFFFFF) for primary text only — use #EDEDED for body copy and #9CA3AF for
secondary text
Consistent border treatment: border-muted/20 (20% opacity muted gray) on all card
and input borders
Focus rings: 2px solid #2E8EFF on all focusable elements for accessibility
Recharts charts: use #2E8EFF as primary data color, #9CA3AF for grid lines and axis
labels
SECTION 19 — Git Branch Strategy and Commit Messages
## Branch Map
## Branch
## Merges
## Into
## Purpose
main—Production only. Never commit directly after init.
devmainIntegration branch. All features land here first.
feature/authdevRegister, login, logout, refresh, Google OAuth
feature/sessionsdevRemember Me, HTTP-only cookies, Redis sessions
feature/onboardingdev
Onboarding steps 1/2/3, 18+ gate, sport and team
selection
feature/cookiesdevCookie consent banner, manage preferences modal
feature/sports-TheSportsDB integration, Redis caching,

datadevteams/scores/games endpoints
feature/feeddevPersonalization algorithm, saved teams, feed endpoint
feature/realtimedevGo WebSocket service, Redis pub/sub, live scores
feature/dashboarddevDashboard page, scores page, teams browse and detail
feature/predictionsdev
ML pipeline, scikit-learn model, predict endpoint,
prediction widget
feature/settingsdevSettings page, profile edit, Google user password setup
feature/legaldev
Landing page, Terms, Privacy, Cookie Policy, About
pages
feature/deploy
dev then
main
Docker prod config, AWS ECS, Nginx SSL, GitHub
Actions, custom domain
fix/*devOne branch per bug fix
## Commit Messages
BranchMilestoneCommit Message
main
Repo cleaned, folder structure built,
Docker running
init: project setup
feature/auth
Ta i l w i n d   c o n f i g   a n d   C S S   va r i a b l e s
applied
feat: design system
feature/authDatabase migrations complete
feat: database schema
feature/authSecurity middleware configured
feat: security
middleware
feature/authRegister, login, logout working
feat: authentication
feature/authGoogle OAuth working
feat: google oauth
feature/sessions
Remember Me and cookie sessions
working
feat: session
management
feature/onboarding
Onboarding flow complete (all 3 steps
+ 18+ gate)
feat: onboarding

feature/cookiesCookie banner and consent systemfeat: cookie consent
feature/sports-
data
TheSportsDB and Redis caching
feat: sports data
feature/sports-
data
Te a m s ,   s c o re s ,   g a m e s   e n d p o i n t s
feat: core endpoints
feature/feedPersonalized feed algorithm
feat: feed
personalization
feature/realtimeGo WebSocket and Redis pub/sub
feat: realtime scores
feature/dashboardDashboard, live scores, teams UI
feat: dashboard
feature/predictions
ML pipeline, prediction endpoint,
widget
feat: predictions
feature/settingsSettings page
feat: settings
feature/legalLegal pages and landing page
feat: legal pages
feature/deployPytest suite complete
test: test suite
feature/deployGitHub Actions CI
ci: github actions
feature/deployDeployed to AWS ECS
deploy: aws ecs
mainCustom domain and SSL live
deploy: production
domain
fix/*Any bug fix
fix: [short
description]
fix/*Any styling update
style: [short
description]
fix/*Any refactor
refactor: [short
description]
SECTION 20 — App Version, API Keys, and Agent Credentials
## App Version

Version: 0.1 — The start of a new beginning
Display v0.1 in the footer on every page and on the About page
After first successful production deployment: git tag v0.1.0 && git push origin
v0.1.0
## Agent Account Instructions
When any service requires signing up during the build:
Email to use: louisdo.work@gmail.com
Password rule: Generate a unique strong password per service. Never reuse
passwords.
Password log: Record every generated password in the Password Log below
immediately after creating the account.
Bypass rule: Agent may sign up for services without waiting for Louis to approve.
Stop rule: If a service requires a credit card, payment, or human verification — stop and
notify Louis.
Stop rule: If a service requires Louis to personally retrieve an API key — stop and notify
## Louis.
Password Log (Agent Must Fill This In)
ServiceUsernamePassword
TheSportsDBlouisdo.work@gmail.com[Agent fills in when created]
## Google Cloud
## Console
louisdo.work@gmail.com
[Louis existing Google account — no new
password]
AWSlouisdo.work@gmail.com[Agent fills in when created]
## Namecheap
(Domain)
louisdo.work@gmail.com[Agent fills in when created]
GitHub (lhd2156)louisdo.work@gmail.com
[Louis existing account — no new
password]
[Any other service]louisdo.work@gmail.com[Agent fills in]

API Keys Required — Stop and Wait Protocol
ServiceWhen NeededWhat Agent Needs from Louis
## Google
OAuth 2.0
## Day 1,
feature/auth
GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
Louis must configure JavaScript Origins and Redirect
URIs — see exact steps below.
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
AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
Agent will guide Louis through creating an IAM user.
## Custom
Domain DNS
Day 3, after
ECS deploy
Agent provides ECS load balancer IP or hostname. Louis
points the domain A record to it.
Google OAuth Setup — Tell Louis to Do These Steps
When you reach Google OAuth implementation, tell Louis to complete the following:
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
- Add Authorized Redirect URIs:
http://localhost:8000/api/auth/google/callback
https://yourdomain.com/api/auth/google/callback
## 7.
Send you the Client ID as GOOGLE_CLIENT_ID
## 8.
Send you the Client Secret as GOOGLE_CLIENT_SECRET
## 9.
Add both to .env immediately

After testing is confirmed working, Louis must rotate the Client Secret.
## Secret Rotation After Testing
Remind Louis to do all of the following after OAuth and AWS are confirmed working:
Generate a new Google OAuth client secret in Google Cloud Console. Update .env and
ECS task env vars.
Generate a new 64-character JWT_SECRET. Update .env and ECS.
Deactivate the test AWS IAM keys. Create new production-only keys with minimal
permissions.
Move all production secrets to AWS Secrets Manager. Remove from .env files in
production.
SECTION 21 — Project Summary
SportSync is a production-grade real-time multi-sport web platform built as a personal
engineering project by Louis Do. It is not affiliated with any academic institution.
The platform delivers live scores, personalized team feeds, ML-powered game predictions,
and a real-time play-by-play activity stream across NFL, NBA, MLB, NHL, MLS, and EPL.
Users authenticate via email/password or Google OAuth 2.0, complete a personalized
onboarding flow, and receive a dashboard tailored to their saved teams and sport
preferences.
The architecture is a two-service microservices system: a Python/FastAPI service handling
REST, auth, ML, and data logic, and a Go/Gin service managing all real-time WebSocket
connections. Both services share a Redis layer for caching, pub/sub messaging, and session
management. The frontend is a React/TypeScript application styled with Tailwind CSS using
a dark-mode-first design system.
Full stack: TypeScript, Python, Go, PostgreSQL, Redis, Docker, Nginx, AWS ECS, AWS S3,
GitHub Actions, JWT, Google OAuth 2.0, scikit-learn, Pandas, NumPy, FastAPI, Gin,
SQLAlchemy, Alembic, Pytest, React, Tailwind CSS, Axios, React Query, Recharts.
SportSync v0.1 is the first release. It is designed to be maintainable, extensible, and
production-ready from day one, with clear readable code, consistent naming conventions,
software design principles applied throughout, and a clean Git history organized by feature
branches.

SECTION 22 — Cost and Domain
ItemCostNotes
TheSportsDB APIFreeNo credit card required
All frameworks and librariesFreeAll open source
GitHub Actions (public repo)FreeUnlimited minutes on public repo
Google OAuthFreeVia Google Cloud Console
Let’s Encrypt SSLFreeAuto-renewed via Nginx
Custom Domain (Namecheap)~$12/yrsportsync.app or similar
AWS ECS and EC2~$5-10/moFree tier year 1 if new account
AWS S3~$1/moMinimal storage needed
To t a l :   e s s e n t i a l l y   f re e   ye a r   1   o n   AW S   f re e   t i e r.   U n d e r  $15/month after.
Domain setup: Buy domain → point DNS A record to AWS ECS load balancer IP → Nginx
handles SSL via Let’s Encrypt (auto-renewed).
SportSync — Agent Build Blueprint — v6 FINAL — Louis Do — Personal Project —
## Confidential