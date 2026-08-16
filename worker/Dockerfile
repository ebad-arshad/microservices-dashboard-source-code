# Stage 1: Build stage
FROM python:3.11-alpine AS builder

WORKDIR /app

RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache gcc musl-dev libpq-dev
COPY requirements.txt ./

RUN pip install --no-cache-dir --upgrade pip wheel setuptools
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime stage
FROM python:3.11-alpine

# Create non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local
COPY . .

# Set permissions
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

ENV PATH=/home/appuser/.local/bin:$PATH
ENV PORT=8002
ENV PYTHONUNBUFFERED=1

EXPOSE 8002

CMD ["python", "main.py"]
