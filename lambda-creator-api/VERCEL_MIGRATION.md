# Vercel Migration Guide

This project has been migrated from AWS Lambda to Vercel + Supabase Edge Functions.

## Architecture

```
Vercel (Lightweight API Routes - 10s timeout)
├── /api/create.js          → Creates/updates agent config
├── /api/agent/[agentId].js → Proxy to Supabase Edge Function
└── /api/cron.js            → Checks for due agents, triggers them

Supabase Edge Functions (Heavy Processing - 60s timeout)
└── execute-agent           → Does all the heavy work (analysis, memes, videos)
```

## Setup Instructions

### 1. Database Migration

Run the migration script in your Supabase SQL editor:

```sql
-- See migrate_to_vercel.sql
```

This adds:
- `last_run` - Timestamp of last execution
- `is_active` - Boolean to enable/disable agents
- `edge_function_url` - URL to Supabase Edge Function

### 2. Supabase Edge Function Setup

#### Install Supabase CLI

```bash
npm install -g supabase
```

#### Initialize Supabase (if not already done)

```bash
cd lambda-creator-api
supabase init
```

#### Deploy Edge Function

```bash
# Link to your project (if not already linked)
supabase link --project-ref YOUR_PROJECT_REF

# Deploy the function
supabase functions deploy execute-agent --project-ref YOUR_PROJECT_REF
```

#### Set Edge Function Secrets

```bash
supabase secrets set SUPER_MEME_API_TOKEN=your-token --project-ref YOUR_PROJECT_REF
```

The Edge Function will automatically have access to:
- `SUPABASE_URL` (auto-provided)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-provided)

### 3. Vercel Deployment

#### Install Vercel CLI (if not installed)

```bash
npm install -g vercel
```

#### Deploy to Vercel

```bash
cd lambda-creator-api
vercel deploy
```

#### Set Environment Variables in Vercel

Go to your Vercel project settings → Environment Variables and add:

**Required:**
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Your Supabase service role key
- `SUPABASE_EDGE_FUNCTION_URL` - Your Edge Function URL (e.g., `https://YOUR_PROJECT.supabase.co/functions/v1/execute-agent`)
- `SUPER_MEME_API_TOKEN` - Your Super Meme API token
- `CRON_SECRET` - Random secret for cron job security (generate with: `openssl rand -hex 32`)

**Optional:**
- `VERCEL_URL` - Auto-set by Vercel, but can override for testing

### 4. Configure Cron Job

The cron job is configured in `vercel.json` to run every minute. Vercel will automatically set it up when you deploy.

To manually trigger the cron job for testing:

```bash
curl -X POST https://your-app.vercel.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## API Endpoints

### POST /api/create

Creates or updates an agent configuration.

**Request:**
```json
{
  "userId": "123"
}
```

**Response:**
```json
{
  "message": "Agent configured successfully!",
  "agent_id": "123",
  "edge_function_url": "https://...",
  "config": {
    "interval": 15,
    "topics": "...",
    "graphic": false,
    "meme": false,
    "video": false
  }
}
```

### POST /api/agent/[agentId]

Executes an agent via Supabase Edge Function.

**Request:**
```json
{
  "message": "optional message"
}
```

**Response:**
```json
{
  "success": true,
  "agent_id": "123",
  "data": {
    "success": true,
    "action": "regular_post"
  }
}
```

### GET /api/cron

Cron job endpoint (called automatically by Vercel every minute).

Checks all active agents and executes those that are due based on their `eventbridge_interval` and `last_run` timestamp.

## How It Works

1. **Agent Creation**: `/api/create` validates agent config and stores Edge Function URL in database
2. **Scheduled Execution**: `/api/cron` runs every minute:
   - Queries all active agents
   - Checks if `(now - last_run) >= interval_minutes`
   - Calls `/api/agent/[agentId]` for due agents
   - Updates `last_run` timestamp
3. **Agent Execution**: `/api/agent/[agentId]` proxies request to Supabase Edge Function
4. **Heavy Processing**: Supabase Edge Function does all the work (analysis API, memes, videos, etc.)

## Differences from AWS Lambda

### Advantages:
- ✅ No AWS account needed
- ✅ Simpler deployment (just `vercel deploy`)
- ✅ Built-in cron jobs
- ✅ Better cold start performance
- ✅ Free tier available

### Limitations:
- ⚠️ Vercel Hobby: 10s timeout (Pro: 60s, Enterprise: 300s)
- ⚠️ Supabase Edge Functions: 60s timeout (vs AWS Lambda 300s)
- ⚠️ Cron minimum interval: 1 minute (vs AWS EventBridge any interval)

### Workarounds:
- Heavy processing moved to Supabase Edge Functions (60s timeout)
- Single cron job checks all agents (instead of per-agent EventBridge rules)
- Dynamic scheduling handled in code (checks `last_run` + `interval`)

## Monitoring

### Vercel Logs
View logs in Vercel dashboard → Functions → Logs

### Supabase Logs
View Edge Function logs:
```bash
supabase functions logs execute-agent --project-ref YOUR_PROJECT_REF
```

### Database Queries

Check active agents:
```sql
SELECT id, eventbridge_interval, last_run, is_active 
FROM agents2 
WHERE is_active = true;
```

Check recent executions:
```sql
SELECT agent_id, created_at, tweet_content 
FROM terminal2 
ORDER BY created_at DESC 
LIMIT 10;
```

## Troubleshooting

### Cron job not running
- Check `vercel.json` is deployed
- Verify cron job appears in Vercel dashboard → Settings → Cron Jobs
- Check `CRON_SECRET` is set correctly

### Edge Function errors
- Check Supabase Edge Function logs
- Verify secrets are set: `supabase secrets list --project-ref YOUR_PROJECT_REF`
- Test Edge Function directly:
  ```bash
  curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/execute-agent \
    -H "Authorization: Bearer YOUR_SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"agent_id": "123"}'
  ```

### Agent not executing
- Check `is_active = true` in database
- Verify `eventbridge_interval` is set
- Check `last_run` timestamp (agents with `NULL` last_run will execute immediately)

## Migration Checklist

- [x] Create Vercel API routes
- [x] Create Supabase Edge Function
- [x] Update package.json (remove AWS SDK)
- [x] Create vercel.json
- [x] Create database migration script
- [ ] Run database migration
- [ ] Deploy Supabase Edge Function
- [ ] Set Edge Function secrets
- [ ] Deploy to Vercel
- [ ] Set Vercel environment variables
- [ ] Test `/api/create` endpoint
- [ ] Test `/api/agent/[agentId]` endpoint
- [ ] Verify cron job is running
- [ ] Monitor logs for errors

## Support

For issues:
1. Check Vercel logs
2. Check Supabase Edge Function logs
3. Verify environment variables are set
4. Check database schema matches migration script


