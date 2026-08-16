# Stage 1: Build stage
FROM python:3.11-slim AS builder

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Runtime stage
FROM python:3.11-slim

# Create non-root user and group
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /root/.local /home/appuser/.local
COPY . .

# Set permissions
RUN chown -R appuser:appgroup /app /home/appuser/.local

# Switch to non-root user
USER appuser

ENV PATH=/home/appuser/.local/bin:$PATH
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
