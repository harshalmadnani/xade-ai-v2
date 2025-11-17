#!/bin/bash
# Automated Supabase Edge Function deployment
# This script will guide you through the process

set -e

PROJECT_REF="wbsnlpviggcnwqfyfobh"
FUNCTION_NAME="execute-agent"

echo "🚀 Supabase Edge Function Deployment"
echo "======================================"
echo ""

# Check if logged in
echo "Checking Supabase authentication..."
if supabase projects list &>/dev/null 2>&1; then
    echo "✅ Already logged in to Supabase"
else
    echo "❌ Not logged in. Starting login process..."
    echo ""
    echo "📋 Please complete the login in your browser..."
    supabase login
    echo ""
fi

# Verify login
if ! supabase projects list &>/dev/null 2>&1; then
    echo "❌ Login failed. Please run 'supabase login' manually and try again."
    exit 1
fi

echo "✅ Authenticated with Supabase"
echo ""

# Link project
echo "📎 Linking project: $PROJECT_REF"
if supabase link --project-ref $PROJECT_REF 2>&1 | grep -q "already linked\|Linked"; then
    echo "✅ Project already linked or linked successfully"
else
    echo "⚠️  Link command output:"
    supabase link --project-ref $PROJECT_REF
fi
echo ""

# Check if function exists
echo "📦 Checking Edge Function: $FUNCTION_NAME"
if [ -f "supabase/functions/$FUNCTION_NAME/index.ts" ]; then
    echo "✅ Function code found"
else
    echo "❌ Function code not found at supabase/functions/$FUNCTION_NAME/index.ts"
    exit 1
fi
echo ""

# Deploy function
echo "🚀 Deploying Edge Function..."
supabase functions deploy $FUNCTION_NAME --project-ref $PROJECT_REF
echo ""

# Check for SUPER_MEME_API_TOKEN in .env
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

if [ -z "$SUPER_MEME_API_TOKEN" ]; then
    echo "⚠️  SUPER_MEME_API_TOKEN not found in .env"
    echo ""
    echo "Please provide your Super Meme API token:"
    read -p "Enter SUPER_MEME_API_TOKEN: " SUPER_MEME_API_TOKEN
    echo ""
fi

if [ ! -z "$SUPER_MEME_API_TOKEN" ]; then
    echo "🔐 Setting SUPER_MEME_API_TOKEN secret..."
    supabase secrets set SUPER_MEME_API_TOKEN=$SUPER_MEME_API_TOKEN --project-ref $PROJECT_REF
    echo "✅ Secret set successfully"
else
    echo "⚠️  No token provided, skipping secret setup"
    echo "   You can set it later with:"
    echo "   supabase secrets set SUPER_MEME_API_TOKEN=your-token --project-ref $PROJECT_REF"
fi
echo ""

# Verify deployment
echo "✅ Deployment Summary"
echo "===================="
echo "Function: $FUNCTION_NAME"
echo "Project: $PROJECT_REF"
echo "URL: https://$PROJECT_REF.supabase.co/functions/v1/$FUNCTION_NAME"
echo ""
echo "Verify deployment:"
echo "  supabase functions list --project-ref $PROJECT_REF"
echo ""
echo "View logs:"
echo "  supabase functions logs $FUNCTION_NAME --project-ref $PROJECT_REF"
echo ""
echo "Test function:"
echo "  curl -X POST https://$PROJECT_REF.supabase.co/functions/v1/$FUNCTION_NAME \\"
echo "    -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"agent_id\": \"TEST_AGENT_ID\"}'"


