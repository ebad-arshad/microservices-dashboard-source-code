import os
import json
import time
import threading
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
import redis
import psycopg2
from psycopg2.extras import RealDictCursor

REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
REDIS_PORT = int(os.environ.get("REDIS_PORT", 6379))
REDIS_PASS = os.environ.get("REDIS_PASSWORD", "")

DB_HOST = os.environ.get("DB_HOST", "postgres")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASS = os.environ.get("DB_PASSWORD", "postgres")
DB_NAME = os.environ.get("DB_NAME", "tasksdb")

PORT = int(os.environ.get("PORT", 8002))

processed_jobs_count = 0
rdb_client = None


def get_db_conn():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        dbname=DB_NAME,
        cursor_factory=RealDictCursor
    )


def init_redis():
    global rdb_client
    while True:
        try:
            rdb_client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                password=REDIS_PASS,
                decode_responses=True
            )
            rdb_client.ping()
            print("[Worker] Connected to Redis successfully.")
            break
        except Exception as e:
            print(f"[Worker] Waiting for Redis... ({e})")
            time.sleep(2)


def redis_queue_consumer():
    global processed_jobs_count
    init_redis()
    print("[Worker] Queue consumer thread started, listening on 'job_queue'...")

    while True:
        try:
            # BLPOP blocks for up to 2 seconds waiting for new queued jobs
            pop_res = rdb_client.blpop("job_queue", timeout=2)
            if not pop_res:
                continue

            _, payload_str = pop_res
            print(f"[Worker] Popped job payload: {payload_str}")
            try:
                job_data = json.loads(payload_str)
            except Exception as e:
                print(f"[Worker] Error parsing job payload JSON: {e}")
                continue

            job_id = job_data.get("id")
            job_type = job_data.get("type", "generate_report")

            # Update status to processing in DB
            try:
                conn = get_db_conn()
                with conn.cursor() as cur:
                    cur.execute("UPDATE jobs SET status = 'processing' WHERE id = %s", (job_id,))
                    conn.commit()
                conn.close()
            except Exception as e:
                print(f"[Worker] DB status update error (processing): {e}")

            # Simulate background execution (e.g. data export / report generation)
            time.sleep(1.5)
            completed_time = datetime.now(timezone.utc).isoformat()
            result_summary = f"Successfully generated '{job_type}' report at {completed_time}. Processed 100% of data."

            # Update status to completed in DB
            try:
                conn = get_db_conn()
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE jobs SET status = 'completed', result = %s, completed_at = %s WHERE id = %s",
                        (result_summary, completed_time, job_id)
                    )
                    conn.commit()
                conn.close()
            except Exception as e:
                print(f"[Worker] DB status update error (completed): {e}")

            processed_jobs_count += 1
            print(f"[Worker] Successfully processed job ID {job_id}")

        except Exception as e:
            print(f"[Worker] Exception in queue consumer loop: {e}")
            time.sleep(2)


class WorkerHealthHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        redis_ok = "connected"
        try:
            if rdb_client:
                rdb_client.ping()
            else:
                redis_ok = "disconnected"
        except Exception as e:
            redis_ok = f"disconnected: {e}"

        resp = {
            "status": "healthy" if redis_ok == "connected" else "unhealthy",
            "worker": "running",
            "redis": redis_ok,
            "processed_jobs": processed_jobs_count,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self.wfile.write(json.dumps(resp).encode("utf-8"))


def run_http_server():
    server_address = ("", PORT)
    httpd = HTTPServer(server_address, WorkerHealthHandler)
    print(f"[Worker] Health HTTP server listening on port {PORT}...")
    httpd.serve_forever()


if __name__ == "__main__":
    consumer_thread = threading.Thread(target=redis_queue_consumer, daemon=True)
    consumer_thread.start()
    run_http_server()
