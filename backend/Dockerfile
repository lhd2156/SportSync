# SportSync API Service
# Python FastAPI for REST, auth, ML, and data logic

FROM python:3.11-slim

# Run as non-root user for security
RUN groupadd -r sportsync && useradd -r -g sportsync sportsync

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

# Switch to non-root user before running
USER sportsync

EXPOSE 8000

CMD ["sh", "/app/docker-entrypoint.sh"]
