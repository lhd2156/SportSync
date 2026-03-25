FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_ASSET_BASE_URL=
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_ASSET_BASE_URL=$VITE_ASSET_BASE_URL

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM nginx:alpine

COPY nginx/nginx.conf /etc/nginx/templates/nginx.https.conf
COPY nginx/nginx.http.conf /etc/nginx/templates/nginx.http.conf
COPY nginx/10-select-config.sh /docker-entrypoint.d/40-select-config.sh
RUN chmod +x /docker-entrypoint.d/40-select-config.sh
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
EXPOSE 443

CMD ["nginx", "-g", "daemon off;"]
