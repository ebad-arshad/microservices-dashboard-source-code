# Stage 1: Build stage
FROM python:3.12-alpine AS builder

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime stage
FROM python:3.12-alpine

# Create dedicated non-root user
RUN addgroup -r appgroup && adduser -r -g appgroup -d /app appuser

WORKDIR /app

# Copy dependencies and application code
COPY --from=builder /install /usr/local
COPY --chown=appuser:appgroup . .

USER appuser

ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
