# Modern Event-Driven Microservices Platform

![Python](https://img.shields.io/badge/Python-3.11%2B-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?logo=docker&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7%20Alpine-DC382D?logo=redis&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20Alpine-4169E1?logo=postgresql&logoColor=white)
![Security](https://img.shields.io/badge/Security-Non--Root%20Containers-success?logo=shield&logoColor=white)
![CI/CD](https://img.shields.io/badge/CI%2FCD-Automated-brightgreen?logo=githubactions&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green.svg)

---

## 1. Executive Architecture Overview

This repository implements a **production-grade, multi-tier event-driven microservices architecture** engineered for low-latency read operations, asynchronous job processing, high availability, and containerized deployment resilience. The platform provides a decoupled task management and asynchronous reporting engine built to handle high throughput under heavy workloads.

### Core Architectural Patterns Implemented

- **Asynchronous Event-Driven Decoupling (Producer/Consumer Pattern)**  
  Long-running heavy compute tasks (such as report generation and data synthesis) are offloaded asynchronously from the synchronous HTTP request-response cycle. The FastAPI backend acts as a **Producer**, inserting job metadata into PostgreSQL and pushing job payloads onto a **Redis Queue (`job_queue`)**. A stateless **Python Background Worker** acts as a **Consumer**, listening via blocking Redis operations (`BLPOP`), executing jobs, and persisting completed state back to PostgreSQL.

- **Read Acceleration via Cache-Aside Pattern**  
  To alleviate database pressure and maintain sub-millisecond API responses, the read flow for main items (`GET /api/items`) implements the **Redis Cache-Aside Pattern**:
  - **Cache Hit:** If item lists exist in Redis (`items:all`), the payload is served directly with an `X-Cache: HIT` HTTP response header.
  - **Cache Miss & TTL:** On cache miss, data is read from PostgreSQL, cached in Redis with a strict **30-second Time-To-Live (TTL)** (configurable via `CACHE_TTL`), and served with an `X-Cache: MISS` header.
  - **Mutation Invalidation:** Write operations (`POST`, `PUT`, `DELETE` on `/api/items` or explicit cache purge requests `POST /api/cache/purge`) atomically invalidate the cache key in Redis, preventing stale data reads.

- **Stateless API & Background Worker Isolation**  
  The system strictly isolates web traffic handling from heavy background processing. The API server scales horizontally without worker thread starvation, while worker instances scale independently based on Redis queue depth.

---

## 2. System Architecture Diagram

```mermaid
flowchart TD
    subgraph Client Tier
        Client["🌐 Web Browser / Client App"]
    end

    subgraph Infrastructure Edge
        Nginx["🛡️ Nginx Reverse Proxy (Frontend Container)<br/>Port: ${FRONTEND_PORT:-80} (Internal 8080)<br/>Non-Root User: nginx"]
    end

    subgraph Compute & Logic Tier
        API["⚡ FastAPI Backend Service<br/>Port: ${BACKEND_PORT:-8000}<br/>Non-Root User: appuser"]
        Worker["⚙️ Async Python Background Worker<br/>Port: ${WORKER_PORT:-8002}<br/>Non-Root User: appuser"]
    end

    subgraph Data & Messaging Tier
        Redis["🔴 Redis 7 Cache & Queue<br/>Port: ${REDIS_PORT:-6379}<br/>Key: items:all | Queue: job_queue"]
        Postgres["🐘 PostgreSQL 16 Database<br/>Port: ${DB_PORT:-5432}<br/>Database: tasksdb"]
    end

    %% Client Routing
    Client -->|HTTP / SPA Assets| Nginx
    Client -->|REST API Requests| API

    %% API Interactions
    API -->|1. Check / Set Cache-Aside (30s TTL)| Redis
    API -->|2. Query / Persist Items & Job Metadata| Postgres
    API -->|3. RPUSH Payload to job_queue| Redis

    %% Worker Interactions
    Worker -->|4. BLPOP Job Payload| Redis
    Worker -->|5. Update Job Status & Results| Postgres
```

---

## 3. Service Directory & Responsibilities Table

| Service Name | Tech Stack | Exposed Port | Non-Root User | Healthcheck Probe | Primary Responsibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`frontend`** | React 18, Vite, Nginx | `${FRONTEND_PORT:-80}:8080` | `nginx` (UID 101) | `wget --spider http://localhost:8080/` | Serves single-page React UI; reverse-proxies REST endpoints. |
| **`backend`** | Python 3.11, FastAPI, Uvicorn | `${BACKEND_PORT:-8000}:8000` | `appuser` (UID 999) | `python -c "...urlopen('.../healthz')"` | Handles synchronous REST APIs, Redis cache coordination, DB migrations. |
| **`worker`** | Python 3.11, Redis Py, Psycopg2 | `${WORKER_PORT:-8002}:8002` | `appuser` (UID 999) | `python -c "...urlopen('.../healthz')"` | Consumes Redis `job_queue`, processes async reports, updates PostgreSQL state. |
| **`postgres`** | PostgreSQL 16 Alpine | `${DB_PORT:-5432}:5432` | `postgres` | `pg_isready -U postgres -d tasksdb` | Primary relational data store for items and asynchronous jobs metadata. |
| **`redis`** | Redis 7 Alpine | `${REDIS_PORT:-6379}:6379` | `redis` | `redis-cli ping` | In-memory key-value cache and message broker queue (`job_queue`). |

---

## 4. Environment Configuration Guide

Environment variables manage secret configurations, database parameters, port bindings, and caching behaviors.

### Setting Up Local Environment

1. **Copy the environment template**:
   ```bash
   cp .env.example .env
   ```

2. **Environment Variable Reference**:

| Environment Variable | Default Value | Description |
| :--- | :--- | :--- |
| `POSTGRES_USER` | `postgres` | Superuser username for PostgreSQL database |
| `POSTGRES_PASSWORD` | `postgres` | Password for PostgreSQL database |
| `POSTGRES_DB` | `tasksdb` | Initial database name created on startup |
| `DB_HOST` | `postgres` | Database hostname inside Docker network (`app-network`) |
| `DB_PORT` | `5432` | Database port binding |
| `REDIS_HOST` | `redis` | Redis service hostname inside Docker network |
| `REDIS_PORT` | `6379` | Redis service port binding |
| `REDIS_PASSWORD` | `""` | Optional password authentication for Redis |
| `BACKEND_PORT` | `8000` | Host port mapped to FastAPI backend container |
| `WORKER_PORT` | `8002` | Host port mapped to Background Worker health container |
| `FRONTEND_PORT` | `80` | Host port mapped to React/Nginx frontend container |
| `CACHE_TTL` | `30` | Time-to-Live (in seconds) for Redis Cache-Aside items |

---

## 5. Security & Container Hardening Principles

The project adheres to strict **DevOps Security & DevSecOps Principles** to guarantee minimal vulnerability surface and cloud-native compliance:

1. **Multi-Stage Container Builds**  
   Both Python and Node.js containers leverage multi-stage Docker builds. Heavy build tools and temporary dependencies are discarded after compiling runtime artifacts, drastically minimizing image footprint and eliminating build tool vulnerability exploits.
2. **Least Privilege Non-Root Container Execution**  
   No process inside any runtime container runs as `root`:
   - Application containers (`backend` and `worker`) execute under a dedicated unprivileged user (`USER appuser`).
   - Frontend container runs using `nginxinc/nginx-unprivileged:alpine`.
3. **Isolated Inter-Container Networking**  
   Services communicate exclusively across a private, user-defined Docker bridge network (`app-network`). External ports are exposed strictly where required for administrative or host testing access.
4. **Strict Healthcheck-Driven Dependency Orchestration**  
   Application microservices enforce explicit launch dependencies using `depends_on: condition: service_healthy`. backend and worker services block until PostgreSQL and Redis pass active healthcheck probes, completely eliminating connection retry crash-loops during cluster startup.

---

## 6. API Specifications & Cache Mechanics

### RESTful API Endpoint Reference

| Path | Method | Expected Status | Cache Behavior / Invalidation | Description |
| :--- | :---: | :---: | :--- | :--- |
| `/healthz` | `GET` | `200 OK` / `503` | Bypass Cache | Deep system probe checking PostgreSQL & Redis connectivity. |
| `/api/items` | `GET` | `200 OK` | **Cache-Aside (30s TTL)** | Fetches item collection; returns `X-Cache: HIT` or `MISS`. |
| `/api/items` | `POST` | `201 Created` | **Purges `items:all`** | Inserts new item to PostgreSQL and invalidates Redis cache. |
| `/api/items/{id}` | `PUT` | `200 OK` | **Purges `items:all`** | Updates target item in PostgreSQL and invalidates Redis cache. |
| `/api/items/{id}` | `DELETE` | `200 OK` | **Purges `items:all`** | Removes item from PostgreSQL and invalidates Redis cache. |
| `/api/cache/purge` | `POST` | `200 OK` | **Manual Eviction** | Direct administrative trigger to purge all active item cache keys. |
| `/api/jobs` | `POST` | `202 Accepted` | Bypass Cache | Enqueues a background job payload to Redis (`job_queue`). |
| `/api/jobs` | `GET` | `200 OK` | Bypass Cache | Fetches recent background job execution logs and statuses. |

### Cache Hit vs. Miss Inspection

Every response to `GET /api/items` contains explicit inspection headers:
- `X-Cache: HIT` – Data served directly from Redis in sub-milliseconds.
- `X-Cache: MISS` – Data retrieved from PostgreSQL, written to Redis with 30s TTL.
- `X-Cache-Source: Redis` or `X-Cache-Source: PostgreSQL`.

### Asynchronous Job State Lifecycle

```
 [ Client POST /api/jobs ]
           │
           ▼
    ┌─────────────┐       Worker pops job from Redis
    │   pending   │ ─────────────────────────────────┐
    └─────────────┘                                  │
           │                                         ▼
           │                                 ┌───────────────┐
           └───────────────────────────────► │  processing   │
                                             └───────────────┘
                                                     │
                                             Job execution finishes
                                                     │
                                                     ▼
                                             ┌───────────────┐
                                             │   completed   │
                                             └───────────────┘
```

---

## 7. Operations & Verification Runbook

### Quickstart Commands

```bash
# 1. Initialize Environment Configuration
cp .env.example .env

# 2. Build and Launch Containerized Stack
docker compose up -d --build

# 3. Check Container Health Status
docker compose ps
```

### Automated Test Suite Execution

The stack includes a production verification script `test-stack.sh` that automatically runs a 15-feature check covering API readiness, Cache HIT/MISS verification, cache mutation purging, database payload integrity, and background job queueing:

```bash
chmod +x test-stack.sh
./test-stack.sh
```

### Direct Database & Cache Debugging

- **Inspect PostgreSQL Database**:
  ```bash
  docker compose exec -it postgres psql -U postgres -d tasksdb -c "SELECT * FROM items;"
  docker compose exec -it postgres psql -U postgres -d tasksdb -c "SELECT * FROM jobs;"
  ```

- **Inspect Redis Cache & Queue**:
  ```bash
  # Check active cache keys
  docker compose exec -it redis redis-cli KEYS "*"

  # Inspect TTL of items cache
  docker compose exec -it redis redis-cli TTL items:all

  # Inspect background queue length
  docker compose exec -it redis redis-cli LLEN job_queue
  ```

### Container Log Inspection

```bash
# Tail all microservices logs concurrently
docker compose logs -f

# Inspect specific container logs
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f redis
docker compose logs -f postgres
```

---

## 8. Roadmap & Production Readiness Next Steps

To prepare this platform for enterprise cloud deployment, the following DevOps enhancements are scheduled:

- [ ] **Kubernetes Migration & Orchestration**
  - Modular **Helm Charts** for environment-based deployment (`dev`, `staging`, `prod`).
  - **Horizontal Pod Autoscaling (HPA)** based on CPU utilization for FastAPI backend and Redis queue length metrics for Worker pods.
- [ ] **Observability & Monitoring Instrumentation**
  - **Prometheus** metrics export (`/metrics`) for FastAPI request latencies and Redis cache hit ratios.
  - **Grafana** dashboard visualization for container health, database connections, and worker queue processing speeds.
  - Distributed tracing via **OpenTelemetry** and **Jaeger**.
- [ ] **CI/CD & Security Pipelines**
  - **GitHub Actions Workflows** for automated linting, unit testing, and container build validation.
  - Vulnerability scanning with **Trivy** and static code analysis with **Bandit** and **SonarQube** prior to image registry push.
