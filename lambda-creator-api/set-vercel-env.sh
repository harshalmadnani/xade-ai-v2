#!/bin/bash
# Script to set Vercel environment variables from .env file

set -e

# Load .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "❌ .env file not found"
    exit 1
fi

PROJECT_REF="wbsnlpviggcnwqfyfobh"
CRON_SECRET="d316fe744e923906d600372827df103a30a68d6f6f5bab22c0c08c16e158b135"

echo "🔐 Setting Vercel environment variables..."
echo ""

# Remove quotes from SUPABASE_URL if present
SUPABASE_URL_CLEAN=$(echo "$SUPABASE_URL" | tr -d "'\"")

# Set environment variables
echo "Setting SUPABASE_URL..."
vercel env add SUPABASE_URL production <<< "$SUPABASE_URL_CLEAN" || vercel env rm SUPABASE_URL production --yes && vercel env add SUPABASE_URL production <<< "$SUPABASE_URL_CLEAN"

echo "Setting SUPABASE_SERVICE_KEY..."
vercel env add SUPABASE_SERVICE_KEY production <<< "$SUPABASE_SERVICE_KEY" || vercel env rm SUPABASE_SERVICE_KEY production --yes && vercel env add SUPABASE_SERVICE_KEY production <<< "$SUPABASE_SERVICE_KEY"

echo "Setting SUPABASE_EDGE_FUNCTION_URL..."
EDGE_FUNCTION_URL="https://${PROJECT_REF}.supabase.co/functions/v1/execute-agent"
vercel env add SUPABASE_EDGE_FUNCTION_URL production <<< "$EDGE_FUNCTION_URL" || vercel env rm SUPABASE_EDGE_FUNCTION_URL production --yes && vercel env add SUPABASE_EDGE_FUNCTION_URL production <<< "$EDGE_FUNCTION_URL"

# Check for SUPER_MEME_API_TOKEN in .env
if [ -z "$SUPER_MEME_API_TOKEN" ]; then
    echo "⚠️  SUPER_MEME_API_TOKEN not found in .env"
    echo "Please add it manually or set it now:"
    read -p "Enter SUPER_MEME_API_TOKEN: " SUPER_MEME_API_TOKEN
fi

if [ ! -z "$SUPER_MEME_API_TOKEN" ]; then
    echo "Setting SUPER_MEME_API_TOKEN..."
    vercel env add SUPER_MEME_API_TOKEN production <<< "$SUPER_MEME_API_TOKEN" || vercel env rm SUPER_MEME_API_TOKEN production --yes && vercel env add SUPER_MEME_API_TOKEN production <<< "$SUPER_MEME_API_TOKEN"
fi

echo "Setting CRON_SECRET..."
vercel env add CRON_SECRET production <<< "$CRON_SECRET" || vercel env rm CRON_SECRET production --yes && vercel env add CRON_SECRET production <<< "$CRON_SECRET"

echo ""
echo "✅ Environment variables set for production"
echo ""
echo "Setting for preview and development environments..."

# Set for preview
vercel env add SUPABASE_URL preview <<< "$SUPABASE_URL_CLEAN" 2>/dev/null || true
vercel env add SUPABASE_SERVICE_KEY preview <<< "$SUPABASE_SERVICE_KEY" 2>/dev/null || true
vercel env add SUPABASE_EDGE_FUNCTION_URL preview <<< "$EDGE_FUNCTION_URL" 2>/dev/null || true
if [ ! -z "$SUPER_MEME_API_TOKEN" ]; then
    vercel env add SUPER_MEME_API_TOKEN preview <<< "$SUPER_MEME_API_TOKEN" 2>/dev/null || true
fi
vercel env add CRON_SECRET preview <<< "$CRON_SECRET" 2>/dev/null || true

# Set for development
vercel env add SUPABASE_URL development <<< "$SUPABASE_URL_CLEAN" 2>/dev/null || true
vercel env add SUPABASE_SERVICE_KEY development <<< "$SUPABASE_SERVICE_KEY" 2>/dev/null || true
vercel env add SUPABASE_EDGE_FUNCTION_URL development <<< "$EDGE_FUNCTION_URL" 2>/dev/null || true
if [ ! -z "$SUPER_MEME_API_TOKEN" ]; then
    vercel env add SUPER_MEME_API_TOKEN development <<< "$SUPER_MEME_API_TOKEN" 2>/dev/null || true
fi
vercel env add CRON_SECRET development <<< "$CRON_SECRET" 2>/dev/null || true

echo ""
echo "✅ All environment variables set!"
echo ""
echo "Redeploying to apply changes..."
vercel --prod


