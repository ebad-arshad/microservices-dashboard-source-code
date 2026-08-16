# Stage 1: Build stage
FROM python:3.11-alpine AS builder

WORKDIR /app

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache gcc musl-dev libpq-dev

COPY requirements.txt ./

# Upgrade build tools globally in builder
RUN pip install --no-cache-dir --upgrade pip wheel setuptools

# Install application dependencies into /install
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime stage
FROM python:3.11-alpine

# Patch OS packages and install runtime PostgreSQL library
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

ENV PORT=8002
ENV PYTHONUNBUFFERED=1

EXPOSE 8002

CMD ["python", "main.py"]
