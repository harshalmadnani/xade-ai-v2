# Deployment Checklist

Follow these steps to deploy the migrated Vercel + Supabase Edge Functions setup.

## Pre-Deployment

- [ ] Review `VERCEL_MIGRATION.md` for architecture details
- [ ] Ensure you have Supabase CLI installed: `npm install -g supabase`
- [ ] Ensure you have Vercel CLI installed: `npm install -g vercel`
- [ ] Have your Supabase project reference ID ready
- [ ] Have your Vercel account ready

## Step 1: Database Migration

- [ ] Open Supabase Dashboard → SQL Editor
- [ ] Copy contents of `migrate_to_vercel.sql`
- [ ] Execute the SQL script
- [ ] Verify new columns exist:
  ```sql
  SELECT column_name FROM information_schema.columns 
  WHERE table_name = 'agents2' 
  AND column_name IN ('last_run', 'is_active', 'edge_function_url');
  ```

## Step 2: Supabase Edge Function Setup

- [ ] Navigate to project directory:
  ```bash
  cd lambda-creator-api
  ```

- [ ] Link Supabase project (if not already linked):
  ```bash
  supabase link --project-ref YOUR_PROJECT_REF
  ```

- [ ] Deploy Edge Function:
  ```bash
  supabase functions deploy execute-agent --project-ref YOUR_PROJECT_REF
  ```

- [ ] Set Edge Function secrets:
  ```bash
  supabase secrets set SUPER_MEME_API_TOKEN=your-token-here --project-ref YOUR_PROJECT_REF
  ```

- [ ] Verify Edge Function is deployed:
  ```bash
  supabase functions list --project-ref YOUR_PROJECT_REF
  ```

- [ ] Test Edge Function directly:
  ```bash
  curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/execute-agent \
    -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"agent_id": "TEST_AGENT_ID"}'
  ```

## Step 3: Vercel Deployment

- [ ] Install dependencies:
  ```bash
  npm install
  ```

- [ ] Login to Vercel (if not already):
  ```bash
  vercel login
  ```

- [ ] Link Vercel project (if not already):
  ```bash
  vercel link
  ```

- [ ] Deploy to Vercel:
  ```bash
  vercel deploy
  ```

- [ ] For production deployment:
  ```bash
  vercel --prod
  ```

## Step 4: Environment Variables

Set these in Vercel Dashboard → Project Settings → Environment Variables:

### Required Variables:

- [ ] `SUPABASE_URL`
  - Value: `https://YOUR_PROJECT.supabase.co`
  - Environment: Production, Preview, Development

- [ ] `SUPABASE_SERVICE_KEY`
  - Value: Your Supabase service role key (from Supabase Dashboard → Settings → API)
  - Environment: Production, Preview, Development
  - ⚠️ Keep this secret!

- [ ] `SUPABASE_EDGE_FUNCTION_URL`
  - Value: `https://YOUR_PROJECT.supabase.co/functions/v1/execute-agent`
  - Environment: Production, Preview, Development

- [ ] `SUPER_MEME_API_TOKEN`
  - Value: Your Super Meme API token
  - Environment: Production, Preview, Development

- [ ] `CRON_SECRET`
  - Value: Generate with `openssl rand -hex 32`
  - Environment: Production, Preview, Development
  - ⚠️ Keep this secret!

### Optional Variables:

- [ ] `VERCEL_URL` (auto-set by Vercel, but can override)

## Step 5: Verify Cron Job

- [ ] Go to Vercel Dashboard → Your Project → Settings → Cron Jobs
- [ ] Verify cron job appears: `/api/cron` scheduled for `* * * * *` (every minute)
- [ ] Check cron job logs after a few minutes to ensure it's running

## Step 6: Testing

### Test Create Endpoint:

```bash
curl -X POST https://YOUR_APP.vercel.app/api/create \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_AGENT_ID"}'
```

Expected: `200 OK` or `409 Conflict` (if agent already exists)

### Test Agent Endpoint:

```bash
curl -X POST https://YOUR_APP.vercel.app/api/agent/YOUR_AGENT_ID \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: `200 OK` with agent execution result

### Test Cron Endpoint:

```bash
curl -X GET https://YOUR_APP.vercel.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expected: `200 OK` with execution results

## Step 7: Monitoring

- [ ] Check Vercel logs: Dashboard → Functions → Logs
- [ ] Check Supabase Edge Function logs:
  ```bash
  supabase functions logs execute-agent --project-ref YOUR_PROJECT_REF
  ```
- [ ] Verify agents are executing:
  ```sql
  SELECT id, last_run, is_active, eventbridge_interval 
  FROM agents2 
  WHERE is_active = true;
  ```
- [ ] Check terminal2 table for new posts:
  ```sql
  SELECT * FROM terminal2 
  ORDER BY created_at DESC 
  LIMIT 10;
  ```

## Troubleshooting

### Cron job not running:
- Check `vercel.json` is in root directory
- Verify cron job appears in Vercel dashboard
- Check environment variables are set
- Review Vercel function logs

### Edge Function errors:
- Check Supabase Edge Function logs
- Verify secrets are set correctly
- Test Edge Function directly with curl
- Check Supabase project is active

### Agent not executing:
- Verify `is_active = true` in database
- Check `eventbridge_interval` is set (> 0)
- Verify `last_run` is NULL or old enough
- Check cron job is running successfully

### API endpoint errors:
- Check Vercel function logs
- Verify environment variables are set
- Test endpoints individually
- Check CORS headers if calling from browser

## Post-Deployment

- [ ] Monitor logs for first 24 hours
- [ ] Verify agents are executing on schedule
- [ ] Check error rates
- [ ] Update team documentation
- [ ] Archive old AWS Lambda functions (optional)

## Rollback Plan

If issues occur:

1. **Revert Vercel deployment:**
   ```bash
   vercel rollback
   ```

2. **Disable cron job:**
   - Vercel Dashboard → Settings → Cron Jobs → Disable

3. **Revert database changes:**
   ```sql
   -- Set all agents inactive
   UPDATE agents2 SET is_active = false;
   ```

4. **Use old AWS Lambda functions** (if still available)

## Support

- Vercel Documentation: https://vercel.com/docs
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Migration Guide: See `VERCEL_MIGRATION.md`


