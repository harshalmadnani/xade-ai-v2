#!/bin/bash
# Quick test script for all endpoints

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
EDGE_FUNCTION_URL="https://wbsnlpviggcnwqfyfobh.supabase.co/functions/v1/execute-agent"
VERCEL_URL="https://lambda-creator-e0ty1xts6-xadefinance1s-projects.vercel.app"
CRON_SECRET="d316fe744e923906d600372827df103a30a68d6f6f5bab22c0c08c16e158b135"

# Load .env if exists
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

echo -e "${GREEN}🧪 Testing Vercel + Supabase Setup${NC}"
echo "=================================="
echo ""

# Get service role key
if [ -z "$SUPABASE_SERVICE_KEY" ]; then
    echo -e "${YELLOW}⚠️  SUPABASE_SERVICE_KEY not found in .env${NC}"
    echo "Please enter your Supabase service role key:"
    read -p "Service Role Key: " SERVICE_KEY
else
    SERVICE_KEY="$SUPABASE_SERVICE_KEY"
fi

# Get test agent ID
if [ -z "$TEST_AGENT_ID" ]; then
    echo ""
    echo "Enter a test agent ID to use:"
    read -p "Agent ID: " AGENT_ID
else
    AGENT_ID="$TEST_AGENT_ID"
fi

echo ""
echo -e "${GREEN}1. Testing Edge Function directly...${NC}"
echo "-----------------------------------"
RESPONSE=$(curl -s -X POST "$EDGE_FUNCTION_URL" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\": \"$AGENT_ID\"}")

if echo "$RESPONSE" | grep -q "success"; then
    echo -e "${GREEN}✅ Edge Function working!${NC}"
    echo "Response: $RESPONSE"
else
    echo -e "${RED}❌ Edge Function error${NC}"
    echo "Response: $RESPONSE"
fi

echo ""
echo -e "${GREEN}2. Testing Vercel Create API...${NC}"
echo "-----------------------------------"
RESPONSE=$(curl -s -X POST "$VERCEL_URL/api/create" \
  -H "Content-Type: application/json" \
  -d "{\"userId\": \"$AGENT_ID\"}")

if echo "$RESPONSE" | grep -q "success\|configured"; then
    echo -e "${GREEN}✅ Create API working!${NC}"
    echo "Response: $RESPONSE"
else
    echo -e "${RED}❌ Create API error${NC}"
    echo "Response: $RESPONSE"
fi

echo ""
echo -e "${GREEN}3. Testing Vercel Agent API...${NC}"
echo "-----------------------------------"
RESPONSE=$(curl -s -X POST "$VERCEL_URL/api/agent/$AGENT_ID" \
  -H "Content-Type: application/json" \
  -d '{}')

if echo "$RESPONSE" | grep -q "success"; then
    echo -e "${GREEN}✅ Agent API working!${NC}"
    echo "Response: $RESPONSE"
else
    echo -e "${RED}❌ Agent API error${NC}"
    echo "Response: $RESPONSE"
fi

echo ""
echo -e "${GREEN}4. Testing Cron Endpoint...${NC}"
echo "-----------------------------------"
RESPONSE=$(curl -s -X GET "$VERCEL_URL/api/cron" \
  -H "Authorization: Bearer $CRON_SECRET")

if echo "$RESPONSE" | grep -q "success\|total_agents"; then
    echo -e "${GREEN}✅ Cron endpoint working!${NC}"
    echo "Response: $RESPONSE"
else
    echo -e "${YELLOW}⚠️  Cron endpoint may require authentication${NC}"
    echo "Response: $RESPONSE"
fi

echo ""
echo -e "${GREEN}✅ Testing complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Check Vercel Dashboard → Cron Jobs to verify cron is running"
echo "2. Check Supabase Dashboard → Edge Functions → Logs"
echo "3. Check database: SELECT * FROM terminal2 ORDER BY created_at DESC LIMIT 10;"


