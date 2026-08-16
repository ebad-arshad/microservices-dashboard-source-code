# Stage 1: Builder stage
FROM python:3.11-slim AS builder

WORKDIR /app

# Upgrade system packages
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime stage
FROM python:3.11-slim

# Patch OS system packages
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

# Create non-root user (Debian syntax)
RUN groupadd -r appgroup && useradd -r -g appgroup -d /home/appuser -m appuser

WORKDIR /app

# Copy dependencies directly into Python standard paths
COPY --from=builder /install /usr/local
COPY . .

RUN chown -R appuser:appgroup /app

USER appuser

ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
