"""
SportSync API - Application-Wide Constants.

All magic numbers and repeated strings live here.
No constant should be defined inline in any other file.
"""

# Application metadata
APP_TITLE = "SportSync API"
APP_VERSION = "0.1"
APP_DESCRIPTION = "Real-time multi-sport platform API"

# Authentication
BCRYPT_COST_FACTOR = 12
MAX_FAILED_LOGIN_ATTEMPTS = 5
ACCOUNT_LOCKOUT_MINUTES = 15
SESSION_TOKEN_BYTES = 32

# Cache TTLs (seconds)
CACHE_TTL_LIVE_SCORES = 120        # 2 minutes for live score data
CACHE_TTL_FEED = 300               # 5 minutes for personalized feed
CACHE_TTL_STANDINGS = 3600         # 1 hour for standings and rosters
CACHE_TTL_TEAM_DATA = 21600        # 6 hours for team metadata
CACHE_TTL_SESSION = 2592000        # 30 days for Remember Me sessions

# Rate Limiting
RATE_LIMIT_LOGIN_MAX = 10          # 10 attempts per IP per window
RATE_LIMIT_LOGIN_WINDOW = 900      # 15 minute window
RATE_LIMIT_REGISTER_MAX = 5        # 5 registrations per IP per window
RATE_LIMIT_REGISTER_WINDOW = 3600  # 1 hour window
RATE_LIMIT_PASSWORD_RESET_MAX = 3  # 3 reset requests per email per window
RATE_LIMIT_PASSWORD_RESET_WINDOW = 3600  # 1 hour window

# Redis Key Prefixes
REDIS_PREFIX_SESSION = "session:"
REDIS_PREFIX_FEED = "feed:"
REDIS_PREFIX_BLACKLIST = "blacklist:"
REDIS_PREFIX_RATE_LIMIT = "rate:"
REDIS_PREFIX_CACHE = "cache:"
REDIS_PREFIX_PASSWORD_RESET = "password-reset:"

# Redis Pub/Sub Channels
REDIS_CHANNEL_LIVE_SCORES = "scores:live"

# Supported Sports and Leagues
SUPPORTED_SPORTS = ["NFL", "NBA", "MLB", "NHL", "MLS", "EPL"]

# Minimum age requirement enforced both client-side and server-side
MINIMUM_AGE_YEARS = 18

# Pagination
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
