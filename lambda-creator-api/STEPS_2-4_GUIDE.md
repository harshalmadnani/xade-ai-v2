# Steps 2-4: Detailed Setup Guide

## Step 2: Supabase Edge Function Setup

### 2.1 Install Supabase CLI

```bash
# Install Supabase CLI globally
npm install -g supabase

# Verify installation
supabase --version
```

### 2.2 Get Your Supabase Project Reference ID

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Settings** → **General**
4. Find **Reference ID** (it looks like: `abcdefghijklmnop`)
5. Copy this ID - you'll need it for all commands

### 2.3 Login to Supabase CLI

```bash
supabase login
```

This will open your browser to authenticate.

### 2.4 Link Your Project

```bash
cd /Users/harshalmadnani/Documents/GitHub/xade-ai-v2/lambda-creator-api
supabase link --project-ref YOUR_PROJECT_REF
```

Replace `YOUR_PROJECT_REF` with your actual project reference ID.

### 2.5 Deploy the Edge Function

```bash
supabase functions deploy execute-agent --project-ref YOUR_PROJECT_REF
```

**Expected output:**
```
Deploying function execute-agent...
Function execute-agent deployed successfully!
```

### 2.6 Set Edge Function Secrets

You need to set the Super Meme API token as a secret:

```bash
supabase secrets set SUPER_MEME_API_TOKEN=your-token-here --project-ref YOUR_PROJECT_REF
```

**To get your Super Meme API token:**
1. Go to https://app.supermeme.ai/
2. Login to your account
3. Go to API settings/dashboard
4. Copy your API token

**Note:** The Edge Function automatically has access to:
- `SUPABASE_URL` (auto-provided)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-provided)

### 2.7 Verify Deployment

```bash
# List all functions
supabase functions list --project-ref YOUR_PROJECT_REF

# View function logs
supabase functions logs execute-agent --project-ref YOUR_PROJECT_REF
```

### 2.8 Test the Edge Function (Optional)

Get your Supabase Service Role Key:
1. Go to Supabase Dashboard → Settings → API
2. Copy the **service_role** key (⚠️ Keep this secret!)

Then test:
```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/execute-agent \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "YOUR_TEST_AGENT_ID"}'
```

---

## Step 3: Vercel Deployment

### 3.1 Install Dependencies

```bash
cd /Users/harshalmadnani/Documents/GitHub/xade-ai-v2/lambda-creator-api
npm install
```

### 3.2 Login to Vercel

```bash
vercel login
```

This will open your browser to authenticate.

### 3.3 Link Your Vercel Project

If you already have a Vercel project:
```bash
vercel link
```

Follow the prompts:
- **Set up and develop?** → Yes
- **Which scope?** → Select your account
- **Link to existing project?** → Yes (if you have one) or No (to create new)
- **Project name?** → Enter a name (e.g., `lambda-creator-api`)
- **Directory?** → `./` (current directory)

### 3.4 Deploy to Vercel

**For preview deployment:**
```bash
vercel deploy
```

**For production deployment:**
```bash
vercel --prod
```

**Expected output:**
```
Vercel CLI 32.x.x
🔍  Inspecting codebase...
✅  Linked to YOUR_PROJECT
🔍  Detected framework: Other
📦  Uploading...
✅  Deploying...
🔗  https://your-project.vercel.app
```

Copy the deployment URL - you'll need it!

---

## Step 4: Environment Variables

### 4.1 Access Vercel Dashboard

1. Go to https://vercel.com/dashboard
2. Click on your project (`lambda-creator-api` or whatever you named it)
3. Go to **Settings** → **Environment Variables**

### 4.2 Set Required Variables

Add each variable one by one:

#### Variable 1: `SUPABASE_URL`
- **Key:** `SUPABASE_URL`
- **Value:** `https://YOUR_PROJECT_REF.supabase.co`
  - Replace `YOUR_PROJECT_REF` with your Supabase project reference ID
- **Environment:** Select all (Production, Preview, Development)
- Click **Save**

#### Variable 2: `SUPABASE_SERVICE_KEY`
- **Key:** `SUPABASE_SERVICE_KEY`
- **Value:** Your Supabase service role key
  - Get it from: Supabase Dashboard → Settings → API → **service_role** key
  - ⚠️ This is sensitive - keep it secret!
- **Environment:** Select all (Production, Preview, Development)
- Click **Save**

#### Variable 3: `SUPABASE_EDGE_FUNCTION_URL`
- **Key:** `SUPABASE_EDGE_FUNCTION_URL`
- **Value:** `https://YOUR_PROJECT_REF.supabase.co/functions/v1/execute-agent`
  - Replace `YOUR_PROJECT_REF` with your Supabase project reference ID
- **Environment:** Select all (Production, Preview, Development)
- Click **Save**

#### Variable 4: `SUPER_MEME_API_TOKEN`
- **Key:** `SUPER_MEME_API_TOKEN`
- **Value:** Your Super Meme API token
  - Get it from: https://app.supermeme.ai/ → API settings
- **Environment:** Select all (Production, Preview, Development)
- Click **Save**

#### Variable 5: `CRON_SECRET`
- **Key:** `CRON_SECRET`
- **Value:** Generate a random secret:
  ```bash
  openssl rand -hex 32
  ```
  Copy the output and use it as the value
- **Environment:** Select all (Production, Preview, Development)
- Click **Save**

### 4.3 Verify Variables Are Set

After adding all variables, you should see:
- ✅ SUPABASE_URL
- ✅ SUPABASE_SERVICE_KEY
- ✅ SUPABASE_EDGE_FUNCTION_URL
- ✅ SUPER_MEME_API_TOKEN
- ✅ CRON_SECRET

### 4.4 Redeploy After Adding Variables

After setting environment variables, redeploy:
```bash
vercel --prod
```

Or trigger a redeploy from Vercel Dashboard → Deployments → Click "..." → Redeploy

---

## Quick Command Reference

```bash
# Step 2: Supabase Edge Function
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy execute-agent --project-ref YOUR_PROJECT_REF
supabase secrets set SUPER_MEME_API_TOKEN=your-token --project-ref YOUR_PROJECT_REF

# Step 3: Vercel Deployment
cd /Users/harshalmadnani/Documents/GitHub/xade-ai-v2/lambda-creator-api
npm install
vercel login
vercel link
vercel --prod

# Step 4: Set environment variables in Vercel Dashboard
# Then redeploy:
vercel --prod
```

---

## Troubleshooting

### Supabase CLI Issues

**"Command not found"**
```bash
npm install -g supabase
```

**"Not authenticated"**
```bash
supabase login
```

**"Project not found"**
- Double-check your project reference ID
- Make sure you're logged into the correct Supabase account

### Vercel CLI Issues

**"Not logged in"**
```bash
vercel login
```

**"Project not linked"**
```bash
vercel link
```

**"Environment variables not working"**
- Make sure you redeployed after adding variables
- Check variable names match exactly (case-sensitive)
- Verify variables are set for the correct environment (Production/Preview/Development)

### Edge Function Issues

**"Function not found"**
- Verify deployment succeeded: `supabase functions list --project-ref YOUR_PROJECT_REF`
- Check function name matches: `execute-agent`

**"Secrets not set"**
- Verify: `supabase secrets list --project-ref YOUR_PROJECT_REF`
- Make sure you used `SUPER_MEME_API_TOKEN` (not `SUPER_MEME_API_KEY`)

---

## Next Steps

After completing steps 2-4:
1. ✅ Test the `/api/create` endpoint
2. ✅ Test the `/api/agent/[agentId]` endpoint
3. ✅ Verify cron job is running (check Vercel Dashboard → Cron Jobs)
4. ✅ Monitor logs for any errors

See `DEPLOYMENT_CHECKLIST.md` for complete testing instructions.


