import os
import json
import uuid
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Response, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor
import redis

# Environment Variable Setup with Fallbacks
DB_HOST = os.environ.get("DB_HOST", "postgres")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASS = os.environ.get("DB_PASSWORD", "postgres")
DB_NAME = os.environ.get("DB_NAME", "tasksdb")

REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
REDIS_PORT = int(os.environ.get("REDIS_PORT", 6379))
REDIS_PASS = os.environ.get("REDIS_PASSWORD", "")

CACHE_KEY_ALL = "items:all"
CACHE_TTL = 30  # 30 seconds TTL

app = FastAPI(title="Microservices FastAPI Backend")

# 1. CORS Configuration with X-Cache Header Exposure
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Cache", "X-Cache-Source"],
)


# Pydantic Schemas
class ItemCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    status: Optional[str] = "pending"


class ItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


class ItemResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = ""
    status: str
    created_at: str


class JobCreate(BaseModel):
    type: Optional[str] = "generate_report"


class JobResponse(BaseModel):
    id: str
    type: str
    status: str
    result: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None


# Database Connection Helper
def get_db_conn():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        dbname=DB_NAME,
        cursor_factory=RealDictCursor,
    )


# Redis Connection Helper
def get_redis_client():
    return redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASS,
        decode_responses=True,
    )


def invalidate_items_cache():
    try:
        rdb = get_redis_client()
        rdb.delete(CACHE_KEY_ALL)
    except Exception as e:
        print(f"Error purging Redis cache: {e}")


# Startup Event: Wait for DB & Run Auto-Migrations
@app.on_event("startup")
def startup_db_migration():
    max_retries = 30
    for i in range(max_retries):
        try:
            conn = get_db_conn()
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS items (
                        id SERIAL PRIMARY KEY,
                        title VARCHAR(255) NOT NULL,
                        description TEXT,
                        status VARCHAR(50) NOT NULL DEFAULT 'pending',
                        created_at TIMESTAMP WITH TIME ZONE
                            DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS jobs (
                        id VARCHAR(255) PRIMARY KEY,
                        type VARCHAR(100) NOT NULL,
                        status VARCHAR(50) NOT NULL DEFAULT 'pending',
                        result TEXT,
                        created_at TIMESTAMP WITH TIME ZONE
                            DEFAULT CURRENT_TIMESTAMP,
                        completed_at TIMESTAMP WITH TIME ZONE
                    );
                """)
                conn.commit()
            conn.close()
            print("PostgreSQL db auto-migrations completed successfully.")
            return
        except Exception as e:
            print(f"Waiting for PostgreSQL... retry {i+1}/{max_retries} ({e})")
            time.sleep(1)
    print("Failed to connect to PostgreSQL during startup.")


# Health Check Endpoint
@app.get("/healthz")
def healthz(response: Response):
    db_status = "connected"
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
        conn.close()
    except Exception as e:
        db_status = f"disconnected: {e}"

    redis_status = "connected"
    try:
        rdb = get_redis_client()
        rdb.ping()
    except Exception as e:
        redis_status = f"disconnected: {e}"

    is_healthy = db_status == "connected" and redis_status == "connected"
    if not is_healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "healthy" if is_healthy else "unhealthy",
        "database": db_status,
        "redis": redis_status,
        "time": datetime.now(timezone.utc).isoformat(),
    }


# 1. READ ITEMS (GET /api/items with Redis Cache-Aside & Search/Filter)
@app.get("/api/items")
def get_items(
    response: Response,
    status_filter: Optional[str] = Query(None, alias="status"),
    q: Optional[str] = Query(None),
):
    # Only use Cache-Aside for unfiltered full list query
    is_unfiltered = not status_filter and not q

    if is_unfiltered:
        try:
            rdb = get_redis_client()
            cached_val = rdb.get(CACHE_KEY_ALL)
            if cached_val:
                response.headers["X-Cache"] = "HIT"
                response.headers["X-Cache-Source"] = "Redis"
                return json.loads(cached_val)
        except Exception as e:
            print(f"Redis cache get error: {e}")

    # Query PostgreSQL
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            q_parts = [
                "SELECT id, title, description, status,",
                "created_at FROM items",
            ]
            query = " ".join(q_parts)
            params = []
            conditions = []

            if status_filter and status_filter.lower() != "all":
                conditions.append("LOWER(status) = %s")
                params.append(status_filter.lower())

            if q:
                conditions.append(
                    "(LOWER(title) LIKE %s OR LOWER(description) LIKE %s)"
                )
                params.append(f"%{q.lower()}%")
                params.append(f"%{q.lower()}%")

            if conditions:
                query += " WHERE " + " AND ".join(conditions)

            query += " ORDER BY id DESC"

            cur.execute(query, params)
            rows = cur.fetchall()
        conn.close()

        items = []
        for r in rows:
            created_dt = r["created_at"]
            if isinstance(created_dt, datetime):
                created_str = created_dt.isoformat()
            else:
                created_str = str(created_dt)
            items.append(
                {
                    "id": r["id"],
                    "title": r["title"],
                    "description": r["description"] or "",
                    "status": r["status"],
                    "created_at": created_str,
                }
            )

        # Cache unfiltered result in Redis
        if is_unfiltered:
            try:
                rdb = get_redis_client()
                rdb.setex(CACHE_KEY_ALL, CACHE_TTL, json.dumps(items))
            except Exception as e:
                print(f"Redis cache set error: {e}")

        response.headers["X-Cache"] = "MISS"
        response.headers["X-Cache-Source"] = "PostgreSQL"
        return items

    except Exception as e:
        err_msg = f"Database query error: {e}"
        raise HTTPException(status_code=500, detail=err_msg)


# 2. CREATE ITEM (POST /api/items)
@app.post("/api/items", status_code=status.HTTP_201_CREATED)
def create_item(item: ItemCreate):
    if not item.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty")

    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            sql_parts = [
                "INSERT INTO items (title, description, status)",
                "VALUES (%s, %s, %s)",
                "RETURNING id, title, description, status, created_at",
            ]
            sql = " ".join(sql_parts)
            cur.execute(
                sql,
                (
                    item.title.strip(),
                    item.description or "",
                    item.status or "pending",
                ),
            )
            new_row = cur.fetchone()
            conn.commit()
        conn.close()

        invalidate_items_cache()

        created_dt = new_row["created_at"]
        if isinstance(created_dt, datetime):
            created_str = created_dt.isoformat()
        else:
            created_str = str(created_dt)

        return {
            "id": new_row["id"],
            "title": new_row["title"],
            "description": new_row["description"] or "",
            "status": new_row["status"],
            "created_at": created_str,
        }
    except Exception as e:
        err_msg = f"Failed to create item: {e}"
        raise HTTPException(status_code=500, detail=err_msg)


# 3. UPDATE ITEM (PUT /api/items/{item_id})
@app.put("/api/items/{item_id}")
def update_item(item_id: int, item: ItemUpdate):
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            sel_parts = [
                "SELECT id, title, description, status",
                "FROM items WHERE id = %s",
            ]
            sql_sel = " ".join(sel_parts)
            cur.execute(sql_sel, (item_id,))
            existing = cur.fetchone()
            if not existing:
                conn.close()
                raise HTTPException(status_code=404, detail="Item not found")

            if item.title is not None:
                new_title = item.title
            else:
                new_title = existing["title"]

            if item.description is not None:
                new_desc = item.description
            else:
                new_desc = existing["description"]

            if item.status is not None:
                new_status = item.status
            else:
                new_status = existing["status"]

            upd_parts = [
                "UPDATE items SET title = %s, description = %s,",
                "status = %s WHERE id = %s RETURNING id, title,",
                "description, status, created_at",
            ]
            sql_upd = " ".join(upd_parts)
            cur.execute(sql_upd, (new_title, new_desc, new_status, item_id))
            updated_row = cur.fetchone()
            conn.commit()
        conn.close()

        invalidate_items_cache()

        created_dt = updated_row["created_at"]
        if isinstance(created_dt, datetime):
            created_str = created_dt.isoformat()
        else:
            created_str = str(created_dt)

        return {
            "id": updated_row["id"],
            "title": updated_row["title"],
            "description": updated_row["description"] or "",
            "status": updated_row["status"],
            "created_at": created_str,
        }
    except HTTPException:
        raise
    except Exception as e:
        err_msg = f"Failed to update item: {e}"
        raise HTTPException(status_code=500, detail=err_msg)


# 4. DELETE ITEM (DELETE /api/items/{item_id})
@app.delete("/api/items/{item_id}")
def delete_item(item_id: int):
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            sql_del = "DELETE FROM items WHERE id = %s RETURNING id"
            cur.execute(sql_del, (item_id,))
            deleted = cur.fetchone()
            conn.commit()
        conn.close()

        if not deleted:
            raise HTTPException(status_code=404, detail="Item not found")

        invalidate_items_cache()

        return {"message": "Item deleted successfully", "id": item_id}
    except HTTPException:
        raise
    except Exception as e:
        err_msg = f"Failed to delete item: {e}"
        raise HTTPException(status_code=500, detail=err_msg)


# 5. ONE-CLICK CACHE PURGE (POST /api/cache/purge)
@app.post("/api/cache/purge")
def purge_cache():
    try:
        rdb = get_redis_client()
        rdb.delete(CACHE_KEY_ALL)
        return {
            "message": "Redis cache purged successfully",
            "purged_keys": [CACHE_KEY_ALL],
        }
    except Exception as e:
        err_msg = f"Failed to purge Redis cache: {e}"
        raise HTTPException(status_code=500, detail=err_msg)


# 6. TRIGGER BACKGROUND JOB (POST /api/jobs)
@app.post("/api/jobs", status_code=status.HTTP_202_ACCEPTED)
def trigger_job(job_in: JobCreate):
    job_id = str(uuid.uuid4())
    job_type = job_in.type or "generate_report"
    created_at = datetime.now(timezone.utc).isoformat()

    try:
        # Save pending job to PostgreSQL
        conn = get_db_conn()
        with conn.cursor() as cur:
            ins_parts = [
                "INSERT INTO jobs (id, type, status, created_at)",
                "VALUES (%s, %s, %s, %s)",
            ]
            sql_ins = " ".join(ins_parts)
            cur.execute(sql_ins, (job_id, job_type, "pending", created_at))
            conn.commit()
        conn.close()

        # Push payload to Redis job queue list
        rdb = get_redis_client()
        job_payload = {
            "id": job_id,
            "type": job_type,
            "created_at": created_at,
        }
        rdb.rpush("job_queue", json.dumps(job_payload))

        return {
            "id": job_id,
            "type": job_type,
            "status": "pending",
            "message": "Background job queued successfully",
        }
    except Exception as e:
        err_msg = f"Failed to queue background job: {e}"
        raise HTTPException(status_code=500, detail=err_msg)


# 7. GET JOBS (GET /api/jobs)
@app.get("/api/jobs")
def get_jobs():
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            job_parts = [
                "SELECT id, type, status, result, created_at, completed_at",
                "FROM jobs ORDER BY created_at DESC LIMIT 20",
            ]
            sql_jobs = " ".join(job_parts)
            cur.execute(sql_jobs)
            rows = cur.fetchall()
        conn.close()

        jobs = []
        for r in rows:
            c_dt = r["created_at"]
            if isinstance(c_dt, datetime):
                c_str = c_dt.isoformat()
            else:
                c_str = str(c_dt)

            comp_dt = r["completed_at"]
            if isinstance(comp_dt, datetime):
                comp_str = comp_dt.isoformat()
            elif comp_dt:
                comp_str = str(comp_dt)
            else:
                comp_str = None

            jobs.append(
                {
                    "id": r["id"],
                    "type": r["type"],
                    "status": r["status"],
                    "result": r["result"],
                    "created_at": c_str,
                    "completed_at": comp_str,
                }
            )
        return jobs
    except Exception as e:
        err_msg = f"Failed to fetch jobs: {e}"
        raise HTTPException(status_code=500, detail=err_msg)
