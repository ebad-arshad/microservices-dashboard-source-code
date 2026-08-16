# Stage 1: Build stage
FROM python:3.12-alpine AS builder

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime stage
FROM python:3.12-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup -h /app

WORKDIR /app

COPY --from=builder /install /usr/local
COPY --chown=appuser:appgroup . .

USER appuser

ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
