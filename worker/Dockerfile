# Stage 1: Builder stage
FROM python:3.15.0rc1-alpine AS builder

WORKDIR /app

RUN apk add --no-cache gcc musl-dev libpq-dev

COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runtime stage
FROM python:3.15.0rc1-alpine

RUN apk --no-cache upgrade && \
    apk add --no-cache libpq && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /install /usr/local
COPY --chown=appuser:appgroup . .

USER appuser

ENV PORT=8002
ENV PYTHONUNBUFFERED=1

EXPOSE 8002

CMD ["python", "main.py"]
