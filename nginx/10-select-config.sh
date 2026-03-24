#!/bin/sh
set -eu

HTTPS_TEMPLATE="/etc/nginx/templates/nginx.https.conf"
HTTP_TEMPLATE="/etc/nginx/templates/nginx.http.conf"
TARGET_CONFIG="/etc/nginx/nginx.conf"

if [ -f /etc/nginx/ssl/fullchain.pem ] && [ -f /etc/nginx/ssl/privkey.pem ]; then
  echo "Using HTTPS nginx configuration"
  cp "$HTTPS_TEMPLATE" "$TARGET_CONFIG"
else
  echo "Using HTTP-only nginx configuration (SSL certs not mounted)"
  cp "$HTTP_TEMPLATE" "$TARGET_CONFIG"
fi
