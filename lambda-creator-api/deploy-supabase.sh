#!/bin/bash
# Script to deploy Supabase Edge Function
# Run this after completing Supabase login

set -e

PROJECT_REF="wbsnlpviggcnwqfyfobh"
FUNCTION_NAME="execute-agent"

echo "🚀 Deploying Supabase Edge Function..."
echo "Project Reference: $PROJECT_REF"
echo ""

# Check if logged in
if ! supabase projects list &>/dev/null; then
    echo "❌ Not logged in to Supabase. Please run: supabase login"
    exit 1
fi

echo "✅ Logged in to Supabase"
echo ""

# Link project
echo "📎 Linking project..."
supabase link --project-ref $PROJECT_REF
echo ""

# Deploy function
echo "📦 Deploying Edge Function: $FUNCTION_NAME..."
supabase functions deploy $FUNCTION_NAME --project-ref $PROJECT_REF
echo ""

# Check if SUPER_MEME_API_TOKEN is set
if [ -z "$SUPER_MEME_API_TOKEN" ]; then
    echo "⚠️  SUPER_MEME_API_TOKEN not set in environment"
    echo "Please set it and run:"
    echo "  export SUPER_MEME_API_TOKEN=your-token"
    echo "  supabase secrets set SUPER_MEME_API_TOKEN=\$SUPER_MEME_API_TOKEN --project-ref $PROJECT_REF"
else
    echo "🔐 Setting SUPER_MEME_API_TOKEN secret..."
    supabase secrets set SUPER_MEME_API_TOKEN=$SUPER_MEME_API_TOKEN --project-ref $PROJECT_REF
    echo ""
fi

echo "✅ Deployment complete!"
echo ""
echo "Verify deployment:"
echo "  supabase functions list --project-ref $PROJECT_REF"
echo ""
echo "View logs:"
echo "  supabase functions logs $FUNCTION_NAME --project-ref $PROJECT_REF"


