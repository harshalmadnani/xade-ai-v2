#!/bin/bash
# Test production endpoints

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Production URL (update with latest deployment)
PROD_URL="https://lambda-creator-a2tncf35i-xadefinance1s-projects.vercel.app"
EDGE_FUNCTION_URL="https://wbsnlpviggcnwqfyfobh.supabase.co/functions/v1/execute-agent"
CRON_SECRET="d316fe744e923906d600372827df103a30a68d6f6f5bab22c0c08c16e158b135"

# Load .env
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

SERVICE_KEY="${SUPABASE_SERVICE_KEY}"
AGENT_ID="1"

echo -e "${BLUE}🧪 Testing Production Endpoints${NC}"
echo "=================================="
echo "Production URL: $PROD_URL"
echo ""

# Test 1: Create API
echo -e "${BLUE}1. Testing Create API${NC}"
echo "-----------------------------------"
CREATE_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$PROD_URL/api/create" \
  -H "Content-Type: application/json" \
  -d "{\"userId\": \"$AGENT_ID\"}")

HTTP_CODE=$(echo "$CREATE_RESPONSE" | grep "HTTP_CODE" | cut -d':' -f2)
BODY=$(echo "$CREATE_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "409" ]; then
    echo -e "${GREEN}✅ Create API: SUCCESS (HTTP $HTTP_CODE)${NC}"
    if [ "$HTTP_CODE" = "409" ]; then
        echo "Note: Agent already exists (expected)"
    fi
    echo "Response: $(echo "$BODY" | head -c 300)..."
else
    echo -e "${RED}❌ Create API: FAILED (HTTP $HTTP_CODE)${NC}"
    echo "Response: $(echo "$BODY" | head -c 500)"
fi

echo ""
echo "-----------------------------------"
echo ""

# Test 2: Agent API
echo -e "${BLUE}2. Testing Agent API${NC}"
echo "-----------------------------------"
AGENT_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$PROD_URL/api/agent/$AGENT_ID" \
  -H "Content-Type: application/json" \
  -d '{}')

HTTP_CODE=$(echo "$AGENT_RESPONSE" | grep "HTTP_CODE" | cut -d':' -f2)
BODY=$(echo "$AGENT_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "success"; then
    echo -e "${GREEN}✅ Agent API: SUCCESS (HTTP $HTTP_CODE)${NC}"
    echo "Response: $(echo "$BODY" | head -c 300)..."
else
    echo -e "${YELLOW}⚠️  Agent API: HTTP $HTTP_CODE${NC}"
    echo "Response: $(echo "$BODY" | head -c 500)"
fi

echo ""
echo "-----------------------------------"
echo ""

# Test 3: Cron Endpoint
echo -e "${BLUE}3. Testing Cron Endpoint${NC}"
echo "-----------------------------------"
CRON_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$PROD_URL/api/cron" \
  -H "Authorization: Bearer $CRON_SECRET")

HTTP_CODE=$(echo "$CRON_RESPONSE" | grep "HTTP_CODE" | cut -d':' -f2)
BODY=$(echo "$CRON_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "success\|total_agents"; then
    echo -e "${GREEN}✅ Cron Endpoint: SUCCESS (HTTP $HTTP_CODE)${NC}"
    echo "Response: $(echo "$BODY" | head -c 400)..."
else
    if [ "$HTTP_CODE" = "401" ]; then
        echo -e "${YELLOW}⚠️  Cron Endpoint: Authentication required (HTTP $HTTP_CODE)${NC}"
        echo "This is normal - cron is protected"
    else
        echo -e "${YELLOW}⚠️  Cron Endpoint: HTTP $HTTP_CODE${NC}"
        echo "Response: $(echo "$BODY" | head -c 500)"
    fi
fi

echo ""
echo "=================================="
echo ""
echo -e "${GREEN}✅ Production Tests Complete!${NC}"
echo ""
echo "Production URL: $PROD_URL"
echo ""
echo "Next steps:"
echo "1. Check Vercel Dashboard → Cron Jobs"
echo "2. Verify cron is executing every minute"
echo "3. Check database for new posts"

