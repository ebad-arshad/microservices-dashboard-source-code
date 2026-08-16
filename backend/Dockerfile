# Stage 1: Build stage
FROM python:3.11-alpine AS builder

WORKDIR /app

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache gcc musl-dev libpq-dev

COPY requirements.txt ./

RUN pip install --no-cache-dir --prefix=/install --upgrade pip "wheel>=0.46.2" "jaraco.context>=6.1.0" setuptools
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime stage
FROM python:3.11-alpine

# Patch OS system packages and install runtime PostgreSQL library
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache libpq

# Create non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy installed packages from builder directly into standard Python location
COPY --from=builder /install /usr/local
COPY . .

# Set permissions
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
