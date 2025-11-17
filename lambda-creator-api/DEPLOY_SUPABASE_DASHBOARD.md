# Deploy Supabase Edge Function via Dashboard

## Option 1: Using Supabase Dashboard (Easiest)

### Step 1: Access Edge Functions in Dashboard

1. Go to: https://supabase.com/dashboard/project/wbsnlpviggcnwqfyfobh
2. Click on **Edge Functions** in the left sidebar
3. You'll see the Edge Functions management page

### Step 2: Create New Function

1. Click **"Create a new function"** or **"New Function"**
2. Function name: `execute-agent`
3. Click **"Create function"**

### Step 3: Upload Function Code

**Method A: Copy-Paste Code**
1. Open the function editor in the dashboard
2. Copy the entire contents of `supabase/functions/execute-agent/index.ts`
3. Paste into the editor
4. Click **"Deploy"** or **"Save"**

**Method B: Upload ZIP File**
1. Create a ZIP file with the function code:
   ```bash
   cd supabase/functions/execute-agent
   zip -r execute-agent.zip index.ts
   ```
2. In the dashboard, click **"Upload"** or **"Deploy from file"**
3. Select the ZIP file
4. Click **"Deploy"**

### Step 4: Set Environment Secrets

1. In the Edge Functions page, click on your function (`execute-agent`)
2. Go to **"Settings"** or **"Secrets"** tab
3. Click **"Add Secret"** or **"Manage Secrets"**
4. Add:
   - **Key:** `SUPER_MEME_API_TOKEN`
   - **Value:** Your Super Meme API token
5. Click **"Save"**

**Note:** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available - you don't need to set them.

### Step 5: Verify Deployment

1. In the Edge Functions page, you should see `execute-agent` listed
2. Click on it to see:
   - Function URL: `https://wbsnlpviggcnwqfyfobh.supabase.co/functions/v1/execute-agent`
   - Status: Active/Deployed
   - Logs (if any)

---

## Option 2: Using Supabase CLI (Alternative)

If you prefer CLI, you still need to login first:

```bash
# Login (opens browser)
supabase login

# Link project
supabase link --project-ref wbsnlpviggcnwqfyfobh

# Deploy
supabase functions deploy execute-agent --project-ref wbsnlpviggcnwqfyfobh

# Set secret
supabase secrets set SUPER_MEME_API_TOKEN=your-token --project-ref wbsnlpviggcnwqfyfobh
```

---

## Quick Dashboard Steps Summary

1. ✅ Go to: https://supabase.com/dashboard/project/wbsnlpviggcnwqfyfobh/edge-functions
2. ✅ Click **"Create a new function"**
3. ✅ Name it: `execute-agent`
4. ✅ Copy code from `supabase/functions/execute-agent/index.ts` and paste
5. ✅ Click **"Deploy"**
6. ✅ Go to function settings → Add secret: `SUPER_MEME_API_TOKEN`
7. ✅ Done!

---

## Verify Function is Working

After deployment, test it:

```bash
curl -X POST https://wbsnlpviggcnwqfyfobh.supabase.co/functions/v1/execute-agent \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "TEST_AGENT_ID"}'
```

Get your service role key from: Dashboard → Settings → API → `service_role` key

---

## Troubleshooting

**Function not appearing?**
- Make sure you're in the correct project
- Refresh the page
- Check if function name matches exactly: `execute-agent`

**Deployment failed?**
- Check the code syntax (TypeScript)
- Look at deployment logs in the dashboard
- Verify all imports are correct

**Secrets not working?**
- Make sure secret name is exactly: `SUPER_MEME_API_TOKEN`
- Redeploy function after adding secrets
- Check function logs for errors


