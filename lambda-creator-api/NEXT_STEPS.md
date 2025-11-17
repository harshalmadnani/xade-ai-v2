# Next Steps - Testing & Verification

## ✅ What's Done

- ✅ Supabase Edge Function deployed: `https://wbsnlpviggcnwqfyfobh.supabase.co/functions/v1/execute-agent`
- ✅ Vercel API routes deployed
- ✅ Environment variables set (mostly)

---

## 🔍 Step 1: Verify Database Migration

Run the migration script in Supabase SQL Editor:

1. Go to: https://supabase.com/dashboard/project/wbsnlpviggcnwqfyfobh/sql/new
2. Copy contents of `migrate_to_vercel.sql`
3. Paste and execute
4. Verify columns exist:
   ```sql
   SELECT column_name 
   FROM information_schema.columns 
   WHERE table_name = 'agents2' 
   AND column_name IN ('last_run', 'is_active', 'edge_function_url', 'eventbridge_interval');
   ```

---

## 🧪 Step 2: Test Supabase Edge Function

Test the Edge Function directly:

```bash
# Get your service role key from: Dashboard → Settings → API → service_role key
curl -X POST https://wbsnlpviggcnwqfyfobh.supabase.co/functions/v1/execute-agent \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "YOUR_TEST_AGENT_ID"}'
```

**Expected response:**
```json
{
  "success": true,
  "action": "regular_post"
}
```

---

## 🧪 Step 3: Test Vercel API Routes

### Test Create Endpoint

```bash
curl -X POST https://lambda-creator-e0ty1xts6-xadefinance1s-projects.vercel.app/api/create \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_AGENT_ID"}'
```

**Expected response:**
```json
{
  "message": "Agent configured successfully!",
  "agent_id": "YOUR_AGENT_ID",
  "edge_function_url": "https://wbsnlpviggcnwqfyfobh.supabase.co/functions/v1/execute-agent",
  "config": {
    "interval": 15,
    "topics": "...",
    "graphic": false,
    "meme": false,
    "video": false
  }
}
```

### Test Agent Endpoint

```bash
curl -X POST https://lambda-creator-e0ty1xts6-xadefinance1s-projects.vercel.app/api/agent/YOUR_AGENT_ID \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected response:**
```json
{
  "success": true,
  "agent_id": "YOUR_AGENT_ID",
  "data": {
    "success": true,
    "action": "regular_post"
  }
}
```

### Test Cron Endpoint (Manual)

```bash
curl -X GET https://lambda-creator-e0ty1xts6-xadefinance1s-projects.vercel.app/api/cron \
  -H "Authorization: Bearer d316fe744e923906d600372827df103a30a68d6f6f5bab22c0c08c16e158b135"
```

**Expected response:**
```json
{
  "success": true,
  "timestamp": "2025-11-16T...",
  "total_agents": 5,
  "due_agents": 2,
  "executed": 2,
  "results": [...]
}
```

---

## ✅ Step 4: Verify Cron Job is Running

1. Go to: https://vercel.com/xadefinance1s-projects/lambda-creator-api/settings/cron
2. Verify cron job exists: `/api/cron` scheduled for `* * * * *` (every minute)
3. Check recent executions in the logs

---

## 🔍 Step 5: Check Logs

### Vercel Logs
1. Go to: https://vercel.com/xadefinance1s-projects/lambda-creator-api/functions
2. Click on a function → View logs
3. Check for any errors

### Supabase Edge Function Logs
1. Go to: https://supabase.com/dashboard/project/wbsnlpviggcnwqfyfobh/edge-functions/execute-agent
2. Click on "Logs" tab
3. Check for execution logs

---

## 📊 Step 6: Verify Agents Are Executing

Check database to see if agents are running:

```sql
-- Check active agents
SELECT id, eventbridge_interval, last_run, is_active 
FROM agents2 
WHERE is_active = true;

-- Check recent posts
SELECT agent_id, created_at, tweet_content 
FROM terminal2 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 🐛 Troubleshooting

### Edge Function Returns 401
- Check Authorization header uses `service_role` key (not `anon` key)
- Verify key is correct from Dashboard → Settings → API

### Edge Function Returns 500
- Check Edge Function logs in Supabase Dashboard
- Verify `SUPER_MEME_API_TOKEN` secret is set (if using meme agents)
- Check function code for errors

### Vercel API Returns 404
- Verify deployment URL is correct
- Check function exists: `api/create.js`, `api/agent/[agentId].js`, `api/cron.js`

### Cron Job Not Running
- Verify cron job exists in Vercel Dashboard → Settings → Cron Jobs
- Check `CRON_SECRET` environment variable is set
- Verify cron endpoint is accessible

### Agents Not Executing
- Check `is_active = true` in database
- Verify `eventbridge_interval` is set (> 0)
- Check `last_run` timestamp (NULL means will execute immediately)
- Verify cron job is running successfully

---

## ✅ Final Checklist

- [ ] Database migration executed
- [ ] Edge Function tested directly
- [ ] `/api/create` endpoint tested
- [ ] `/api/agent/[agentId]` endpoint tested
- [ ] Cron job appears in Vercel Dashboard
- [ ] Cron job executing successfully
- [ ] Agents executing on schedule
- [ ] Logs show no errors
- [ ] Posts appearing in `terminal2` table

---

## 🎉 Success Indicators

You'll know everything is working when:

1. ✅ Cron job runs every minute (check Vercel logs)
2. ✅ Agents execute based on their `eventbridge_interval`
3. ✅ New posts appear in `terminal2` table
4. ✅ `last_run` timestamp updates for agents
5. ✅ No errors in logs

---

## 📝 Quick Test Commands

```bash
# Test Edge Function
curl -X POST https://wbsnlpviggcnwqfyfobh.supabase.co/functions/v1/execute-agent \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "YOUR_AGENT_ID"}'

# Test Create API
curl -X POST https://lambda-creator-e0ty1xts6-xadefinance1s-projects.vercel.app/api/create \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_AGENT_ID"}'

# Test Agent API
curl -X POST https://lambda-creator-e0ty1xts6-xadefinance1s-projects.vercel.app/api/agent/YOUR_AGENT_ID \
  -H "Content-Type: application/json" \
  -d '{}'
```


