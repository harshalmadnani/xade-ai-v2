#!/bin/bash
# Simple script to set/update Vercel environment variables

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

# Remove quotes from SUPABASE_URL if present
SUPABASE_URL_CLEAN=$(echo "$SUPABASE_URL" | tr -d "'\"")
EDGE_FUNCTION_URL="https://${PROJECT_REF}.supabase.co/functions/v1/execute-agent"

echo "🔐 Setting Vercel environment variables..."
echo ""

# Function to set or update env var
set_env_var() {
    local key=$1
    local value=$2
    local env=${3:-production}
    
    echo "Setting $key for $env..."
    # Try to remove existing first, then add
    vercel env rm "$key" "$env" --yes 2>/dev/null || true
    echo "$value" | vercel env add "$key" "$env" <<< "$value" || {
        echo "⚠️  Failed to set $key, may already exist with different value"
        echo "   Please update manually in Vercel Dashboard"
    }
}

# Set for all environments
for env in production preview development; do
    echo "=== Setting variables for $env ==="
    set_env_var "SUPABASE_URL" "$SUPABASE_URL_CLEAN" "$env"
    set_env_var "SUPABASE_SERVICE_KEY" "$SUPABASE_SERVICE_KEY" "$env"
    set_env_var "SUPABASE_EDGE_FUNCTION_URL" "$EDGE_FUNCTION_URL" "$env"
    set_env_var "CRON_SECRET" "$CRON_SECRET" "$env"
    
    # Check for SUPER_MEME_API_TOKEN
    if [ ! -z "$SUPER_MEME_API_TOKEN" ]; then
        set_env_var "SUPER_MEME_API_TOKEN" "$SUPER_MEME_API_TOKEN" "$env"
    else
        echo "⚠️  SUPER_MEME_API_TOKEN not in .env - skipping"
    fi
    echo ""
done

echo "✅ Environment variables configured!"
echo ""
echo "📋 Summary:"
echo "  SUPABASE_URL: $SUPABASE_URL_CLEAN"
echo "  SUPABASE_SERVICE_KEY: ✅ Set"
echo "  SUPABASE_EDGE_FUNCTION_URL: $EDGE_FUNCTION_URL"
echo "  CRON_SECRET: ✅ Set"
if [ ! -z "$SUPER_MEME_API_TOKEN" ]; then
    echo "  SUPER_MEME_API_TOKEN: ✅ Set"
else
    echo "  SUPER_MEME_API_TOKEN: ⚠️  Not set (add manually)"
fi
echo ""
echo "🚀 Redeploying to apply changes..."
vercel --prod


