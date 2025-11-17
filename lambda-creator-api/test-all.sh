#!/bin/bash
# Test all endpoints automatically

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
EDGE_FUNCTION_URL="https://wbsnlpviggcnwqfyfobh.supabase.co/functions/v1/execute-agent"
VERCEL_URL="https://lambda-creator-e0ty1xts6-xadefinance1s-projects.vercel.app"
CRON_SECRET="d316fe744e923906d600372827df103a30a68d6f6f5bab22c0c08c16e158b135"

# Load .env
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Get service key
SERVICE_KEY="${SUPABASE_SERVICE_KEY}"
if [ -z "$SERVICE_KEY" ]; then
    echo -e "${RED}❌ SUPABASE_SERVICE_KEY not found in .env${NC}"
    exit 1
fi

echo -e "${BLUE}🧪 Testing All Endpoints${NC}"
echo "=================================="
echo ""

# Get a test agent ID from database or use a default
echo -e "${YELLOW}📋 Fetching test agent ID from database...${NC}"
AGENT_RESPONSE=$(curl -s "${SUPABASE_URL}/rest/v1/agents2?select=id&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}")

AGENT_ID=$(echo "$AGENT_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -z "$AGENT_ID" ]; then
    echo -e "${YELLOW}⚠️  No agent found in database. Using test ID: 1${NC}"
    AGENT_ID="1"
else
    echo -e "${GREEN}✅ Found agent ID: $AGENT_ID${NC}"
fi

echo ""
echo "=================================="
echo ""

# Test 1: Edge Function
echo -e "${BLUE}1. Testing Supabase Edge Function${NC}"
echo "-----------------------------------"
EDGE_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$EDGE_FUNCTION_URL" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\": \"$AGENT_ID\"}")

HTTP_CODE=$(echo "$EDGE_RESPONSE" | grep "HTTP_CODE" | cut -d':' -f2)
BODY=$(echo "$EDGE_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "success"; then
    echo -e "${GREEN}✅ Edge Function: SUCCESS (HTTP $HTTP_CODE)${NC}"
    echo "Response: $(echo "$BODY" | head -c 200)..."
else
    echo -e "${RED}❌ Edge Function: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "Response: $BODY"
fi

echo ""
echo "-----------------------------------"
echo ""

# Test 2: Vercel Create API
echo -e "${BLUE}2. Testing Vercel Create API${NC}"
echo "-----------------------------------"
CREATE_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$VERCEL_URL/api/create" \
  -H "Content-Type: application/json" \
  -d "{\"userId\": \"$AGENT_ID\"}")

HTTP_CODE=$(echo "$CREATE_RESPONSE" | grep "HTTP_CODE" | cut -d':' -f2)
BODY=$(echo "$CREATE_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "409" ]; then
    echo -e "${GREEN}✅ Create API: SUCCESS (HTTP $HTTP_CODE)${NC}"
    if [ "$HTTP_CODE" = "409" ]; then
        echo "Note: Agent already exists (expected)"
    fi
    echo "Response: $(echo "$BODY" | head -c 200)..."
else
    echo -e "${RED}❌ Create API: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "Response: $BODY"
fi

echo ""
echo "-----------------------------------"
echo ""

# Test 3: Vercel Agent API
echo -e "${BLUE}3. Testing Vercel Agent API${NC}"
echo "-----------------------------------"
AGENT_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$VERCEL_URL/api/agent/$AGENT_ID" \
  -H "Content-Type: application/json" \
  -d '{}')

HTTP_CODE=$(echo "$AGENT_RESPONSE" | grep "HTTP_CODE" | cut -d':' -f2)
BODY=$(echo "$AGENT_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "success"; then
    echo -e "${GREEN}✅ Agent API: SUCCESS (HTTP $HTTP_CODE)${NC}"
    echo "Response: $(echo "$BODY" | head -c 200)..."
else
    echo -e "${YELLOW}⚠️  Agent API: HTTP $HTTP_CODE${NC}"
    echo "Response: $BODY"
    if [ "$HTTP_CODE" = "404" ]; then
        echo "Note: Agent may need to be created first via /api/create"
    fi
fi

echo ""
echo "-----------------------------------"
echo ""

# Test 4: Cron Endpoint
echo -e "${BLUE}4. Testing Cron Endpoint${NC}"
echo "-----------------------------------"
CRON_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$VERCEL_URL/api/cron" \
  -H "Authorization: Bearer $CRON_SECRET")

HTTP_CODE=$(echo "$CRON_RESPONSE" | grep "HTTP_CODE" | cut -d':' -f2)
BODY=$(echo "$CRON_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "success\|total_agents"; then
    echo -e "${GREEN}✅ Cron Endpoint: SUCCESS (HTTP $HTTP_CODE)${NC}"
    echo "Response: $(echo "$BODY" | head -c 300)..."
else
    if [ "$HTTP_CODE" = "401" ]; then
        echo -e "${YELLOW}⚠️  Cron Endpoint: Authentication required (HTTP $HTTP_CODE)${NC}"
        echo "This is normal - cron is protected"
    else
        echo -e "${YELLOW}⚠️  Cron Endpoint: HTTP $HTTP_CODE${NC}"
        echo "Response: $BODY"
    fi
fi

echo ""
echo "=================================="
echo ""
echo -e "${BLUE}📊 Test Summary${NC}"
echo "-----------------------------------"
echo "Edge Function URL: $EDGE_FUNCTION_URL"
echo "Vercel API URL: $VERCEL_URL"
echo "Test Agent ID: $AGENT_ID"
echo ""
echo -e "${GREEN}✅ Tests completed!${NC}"
echo ""
echo "Next steps:"
echo "1. Check Vercel Dashboard → Cron Jobs"
echo "2. Check Supabase Dashboard → Edge Functions → Logs"
echo "3. Verify database: SELECT * FROM terminal2 ORDER BY created_at DESC LIMIT 10;"


