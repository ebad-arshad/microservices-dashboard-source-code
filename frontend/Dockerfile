# Stage 1: Build React Application
FROM node:20-alpine3.20 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production Nginx Server (Unprivileged user execution)
FROM nginxinc/nginx-unprivileged:alpine3.20-slim

USER root
RUN apk update && apk upgrade --no-cache
USER nginx

# Copy build assets to Nginx html directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
