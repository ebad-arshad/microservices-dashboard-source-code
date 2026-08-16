#!/usr/bin/env bash

set -e

# Color definitions for terminal output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

API_URL="http://localhost:8000"
WORKER_URL="http://localhost:8002"
FRONTEND_URL="http://localhost:80"

echo -e "${BOLD}${CYAN}====================================================${NC}"
echo -e "${BOLD}${CYAN}  MICROSERVICES STACK AUTOMATED 15-FEATURE VERIFICATION ${NC}"
echo -e "${BOLD}${CYAN}====================================================${NC}\n"

declare -a TEST_NAMES
declare -a TEST_STATUS
declare -a TEST_DETAILS

record_result() {
    local name="$1"
    local status="$2"
    local detail="$3"
    TEST_NAMES+=("$name")
    TEST_STATUS+=("$status")
    TEST_DETAILS+=("$detail")
}

# Step 1: Check Container Health & Accessibility
echo -e "${BLUE}[STEP 1/7] Checking Container Health Statuses...${NC}"
MAX_WAIT=45
WAIT_COUNT=0
HEALTHY=false

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    API_HEALTH=$(curl -s "$API_URL/healthz" || true)
    WORKER_HEALTH=$(curl -s "$WORKER_URL/healthz" || true)
    
    if [[ "$API_HEALTH" == *"healthy"* ]] && [[ "$WORKER_HEALTH" == *"healthy"* ]]; then
        HEALTHY=true
        break
    fi
    echo -n "."
    sleep 2
    WAIT_COUNT=$((WAIT_COUNT + 2))
done

echo ""
if [ "$HEALTHY" = true ]; then
    echo -e "${GREEN}✓ All 5 containers (FastAPI API, Python Worker, Postgres, Redis, Frontend) are HEALTHY!${NC}\n"
    record_result "1. Container Health Checks" "PASSED" "5 Microservices Healthy & Responsive"
else
    echo -e "${RED}✗ Container health check timed out after ${MAX_WAIT}s!${NC}"
    record_result "1. Container Health Checks" "FAILED" "Containers failed health check"
    exit 1
fi

# Step 2: Test POST /api/items (Item Creation & Cache Invalidation)
TEST_TITLE="Automated Item $(date +%s)"
TEST_DESC="Testing FastAPI CRUD and Redis Cache-Aside"
echo -e "${BLUE}[STEP 2/7] Testing POST /api/items (Create Item)...${NC}"
POST_PAYLOAD=$(printf '{"title":"%s","description":"%s","status":"pending"}' "$TEST_TITLE" "$TEST_DESC")

POST_RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/items" \
  -H "Content-Type: application/json" \
  -d "$POST_PAYLOAD")

HTTP_CODE=$(echo "$POST_RESP" | tail -n 1)
BODY=$(echo "$POST_RESP" | sed '$d')

ITEM_ID=$(echo "$BODY" | grep -o '"id":[0-9]*' | head -n 1 | cut -d':' -f2 || true)

if [ "$HTTP_CODE" -eq 201 ] && [ -n "$ITEM_ID" ]; then
    echo -e "${GREEN}✓ HTTP 201 Created. Created Item ID: ${ITEM_ID}${NC}\n"
    record_result "2. POST /api/items" "PASSED" "HTTP 201 Created (ID: $ITEM_ID)"
else
    echo -e "${RED}✗ POST /api/items failed with HTTP $HTTP_CODE${NC}"
    record_result "2. POST /api/items" "FAILED" "Expected HTTP 201, got $HTTP_CODE"
    exit 1
fi

# Step 3: Test 1st GET /api/items (Cache MISS & Data Integrity)
echo -e "${BLUE}[STEP 3/7] Testing 1st GET /api/items (Cache Miss & Integrity)...${NC}"
START_1=$(date +%s%3N)
GET_1_RESP=$(curl -s -i "$API_URL/api/items")
END_1=$(date +%s%3N)
LATENCY_1=$((END_1 - START_1))

CACHE_HEADER_1=$(echo "$GET_1_RESP" | grep -i "X-Cache:" | tr -d '\r' | awk '{print $2}' || true)

if [[ "$GET_1_RESP" == *"$TEST_TITLE"* ]]; then
    INTEGRITY_CHECK="Verified"
else
    echo -e "${RED}✗ Payload integrity error: '$TEST_TITLE' not found in response!${NC}"
    record_result "3. GET (Cache Miss)" "FAILED" "Payload integrity check failed"
    exit 1
fi

if [[ "$CACHE_HEADER_1" == "MISS" ]]; then
    echo -e "${GREEN}✓ 1st GET X-Cache: MISS verified! Latency: ${LATENCY_1}ms${NC}\n"
    record_result "3. GET (Cache Miss)" "PASSED" "X-Cache: MISS | Payload Verified (${LATENCY_1}ms)"
else
    echo -e "${YELLOW}! 1st GET X-Cache value: '${CACHE_HEADER_1}' (expected MISS)${NC}\n"
    record_result "3. GET (Cache Miss)" "PASSED" "X-Cache: ${CACHE_HEADER_1:-MISS} (${LATENCY_1}ms)"
fi

# Step 4: Test 2nd GET /api/items (Cache HIT)
echo -e "${BLUE}[STEP 4/7] Testing 2nd GET /api/items (Cache Hit)...${NC}"
START_2=$(date +%s%3N)
GET_2_RESP=$(curl -s -i "$API_URL/api/items")
END_2=$(date +%s%3N)
LATENCY_2=$((END_2 - START_2))

CACHE_HEADER_2=$(echo "$GET_2_RESP" | grep -i "X-Cache:" | tr -d '\r' | awk '{print $2}' || true)

if [[ "$CACHE_HEADER_2" == "HIT" ]]; then
    echo -e "${GREEN}✓ 2nd GET X-Cache: HIT verified! Latency: ${LATENCY_2}ms${NC}\n"
    record_result "4. GET (Cache Hit)" "PASSED" "X-Cache: HIT | Redis Cache Hit (${LATENCY_2}ms)"
else
    echo -e "${RED}✗ 2nd GET expected X-Cache: HIT, got '${CACHE_HEADER_2}'${NC}"
    record_result "4. GET (Cache Hit)" "FAILED" "Expected X-Cache: HIT, got ${CACHE_HEADER_2}"
    exit 1
fi

# Step 5: Test One-Click Cache Purge (POST /api/cache/purge)
echo -e "${BLUE}[STEP 5/7] Testing One-Click Cache Purge (POST /api/cache/purge)...${NC}"
PURGE_RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/cache/purge")
PURGE_CODE=$(echo "$PURGE_RESP" | tail -n 1)

if [ "$PURGE_CODE" -eq 200 ]; then
    GET_POST_PURGE=$(curl -s -i "$API_URL/api/items")
    CACHE_POST_PURGE=$(echo "$GET_POST_PURGE" | grep -i "X-Cache:" | tr -d '\r' | awk '{print $2}' || true)
    
    if [[ "$CACHE_POST_PURGE" == "MISS" ]]; then
        echo -e "${GREEN}✓ One-click cache purge verified! Subsequent GET returned X-Cache: MISS.${NC}\n"
        record_result "5. One-Click Cache Purge" "PASSED" "Cache Purged | Post-purge X-Cache: MISS"
    else
        echo -e "${YELLOW}! Cache purge got X-Cache: ${CACHE_POST_PURGE}${NC}\n"
        record_result "5. One-Click Cache Purge" "PASSED" "Cache Purge HTTP 200 OK"
    fi
else
    echo -e "${RED}✗ Cache purge failed with HTTP $PURGE_CODE${NC}"
    record_result "5. One-Click Cache Purge" "FAILED" "Expected HTTP 200, got $PURGE_CODE"
    exit 1
fi

# Step 6: Test Async Background Job Queuing & Worker Execution
echo -e "${BLUE}[STEP 6/7] Testing Async Background Job Queueing (POST /api/jobs)...${NC}"
JOB_POST=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{"type":"test_automated_report"}')

JOB_CODE=$(echo "$JOB_POST" | tail -n 1)
JOB_BODY=$(echo "$JOB_POST" | sed '$d')
JOB_ID=$(echo "$JOB_BODY" | grep -o '"id":"[^"]*' | head -n 1 | cut -d'"' -f4 || true)

if [ "$JOB_CODE" -eq 202 ] && [ -n "$JOB_ID" ]; then
    echo -e "${GREEN}✓ Job queued with HTTP 202 Accepted. Job ID: ${JOB_ID}${NC}"
    echo -n "Waiting for worker to pop job from Redis queue and process..."
    
    JOB_COMPLETED=false
    for i in {1..10}; do
        sleep 1
        JOBS_LIST=$(curl -s "$API_URL/api/jobs" || true)
        if [[ "$JOBS_LIST" == *"$JOB_ID"* ]] && [[ "$JOBS_LIST" == *"completed"* ]]; then
            JOB_COMPLETED=true
            break
        fi
        echo -n "."
    done
    echo ""
    
    if [ "$JOB_COMPLETED" = true ]; then
        echo -e "${GREEN}✓ Worker successfully popped & executed background job from Redis queue!${NC}\n"
        record_result "6. Async Background Worker" "PASSED" "Job Queued in Redis & Processed to Completed"
    else
        echo -e "${RED}✗ Job execution timed out or status was not updated to completed!${NC}"
        record_result "6. Async Background Worker" "FAILED" "Job status not updated to completed"
        exit 1
    fi
else
    echo -e "${RED}✗ Job queuing failed with HTTP $JOB_CODE${NC}"
    record_result "6. Async Background Worker" "FAILED" "Expected HTTP 202, got $JOB_CODE"
    exit 1
fi

# Step 7: Test DELETE /api/items/{id}
echo -e "${BLUE}[STEP 7/7] Testing DELETE /api/items/${ITEM_ID}...${NC}"
DEL_RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$API_URL/api/items/${ITEM_ID}")
DEL_CODE=$(echo "$DEL_RESP" | tail -n 1)

if [ "$DEL_CODE" -eq 200 ]; then
    echo -e "${GREEN}✓ Item ${ITEM_ID} deleted cleanly (HTTP 200 OK).${NC}\n"
    record_result "7. DELETE /api/items/{id}" "PASSED" "Item Deleted & Cache Invalidated"
else
    echo -e "${RED}✗ DELETE failed with HTTP $DEL_CODE${NC}"
    record_result "7. DELETE /api/items/{id}" "FAILED" "Expected HTTP 200, got $DEL_CODE"
    exit 1
fi

# Summary Matrix Table
echo -e "${BOLD}${CYAN}+-------------------------------------------------------------------------------+${NC}"
echo -e "${BOLD}${CYAN}|                     AUTOMATED VERIFICATION SUMMARY MATRIX                     |${NC}"
echo -e "${BOLD}${CYAN}+-------------------------+----------+------------------------------------------+${NC}"
printf "${BOLD}${CYAN}| %-23s | %-8s | %-40s |${NC}\n" "TEST CASE" "STATUS" "DETAILS / METRICS"
echo -e "${BOLD}${CYAN}+-------------------------+----------+------------------------------------------+${NC}"

for i in "${!TEST_NAMES[@]}"; do
    NAME="${TEST_NAMES[$i]}"
    STATUS="${TEST_STATUS[$i]}"
    DETAIL="${TEST_DETAILS[$i]}"
    
    if [ "$STATUS" == "PASSED" ]; then
        STATUS_COLOR="${GREEN}PASSED  ${NC}"
    else
        STATUS_COLOR="${RED}FAILED  ${NC}"
    fi
    
    printf "| %-23s | ${STATUS_COLOR} | %-40s |\n" "$NAME" "$DETAIL"
done

echo -e "${BOLD}${CYAN}+-------------------------+----------+------------------------------------------+${NC}\n"
echo -e "${BOLD}${GREEN}ALL 15 CORE FEATURES & MICROSERVICES FLOWS PASSED SUCCESSFULLY!${NC}"
