#!/bin/sh
set -eu

HTTPS_TEMPLATE="/etc/nginx/templates/nginx.https.conf"
HTTP_TEMPLATE="/etc/nginx/templates/nginx.http.conf"
TARGET_CONFIG="/etc/nginx/nginx.conf"
ALLOWLIST_DIR="/etc/nginx/includes"
ALLOWLIST_FILE="$ALLOWLIST_DIR/api-allowlist.conf"
TLS_DOMAIN="${TLS_DOMAIN:-onsportsync.com}"
TLS_FULLCHAIN="/etc/letsencrypt/live/${TLS_DOMAIN}/fullchain.pem"
TLS_PRIVKEY="/etc/letsencrypt/live/${TLS_DOMAIN}/privkey.pem"

mkdir -p "$ALLOWLIST_DIR"

if [ -n "${API_IP_ALLOWLIST:-}" ]; then
  : > "$ALLOWLIST_FILE"
  OLD_IFS=$IFS
  IFS=','
  for entry in $API_IP_ALLOWLIST; do
    trimmed=$(echo "$entry" | xargs)
    if [ -n "$trimmed" ]; then
      echo "allow $trimmed;" >> "$ALLOWLIST_FILE"
    fi
  done
  IFS=$OLD_IFS
  echo "deny all;" >> "$ALLOWLIST_FILE"
else
  cat > "$ALLOWLIST_FILE" <<'EOF'
# No API IP allowlist configured.
EOF
fi

if [ -f "$TLS_FULLCHAIN" ] && [ -f "$TLS_PRIVKEY" ]; then
  echo "Using HTTPS nginx configuration"
  cp "$HTTPS_TEMPLATE" "$TARGET_CONFIG"
else
  echo "Using HTTP-only nginx configuration (SSL certs not mounted)"
  cp "$HTTP_TEMPLATE" "$TARGET_CONFIG"
fi
