# Supabase Edge Function Secrets

## Required Secrets

When deploying the `execute-agent` Edge Function, you need to add **ONE secret**:

### ✅ SUPER_MEME_API_TOKEN

**Key:** `SUPER_MEME_API_TOKEN`  
**Value:** Your Super Meme API token  
**Required:** Yes (if you're using meme agents)

**How to get it:**
1. Go to https://app.supermeme.ai/
2. Login to your account
3. Navigate to API settings/dashboard
4. Copy your API token

---

## Auto-Provided (Don't Add These)

These are **automatically available** to all Supabase Edge Functions - you don't need to set them:

- ✅ `SUPABASE_URL` - Auto-provided
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Auto-provided (as `SUPABASE_SERVICE_ROLE_KEY`)

**Note:** The code uses `SUPABASE_SERVICE_ROLE_KEY` which Supabase automatically provides. You don't need to set it manually.

---

## How to Add Secrets in Dashboard

### Step 1: Go to Edge Functions
1. Open: https://supabase.com/dashboard/project/wbsnlpviggcnwqfyfobh/edge-functions
2. Click on your function: `execute-agent`

### Step 2: Add Secret
1. Click on **"Settings"** tab (or look for **"Secrets"** or **"Environment Variables"**)
2. Scroll to **"Secrets"** section
3. Click **"Add Secret"** or **"New Secret"**
4. Enter:
   - **Name:** `SUPER_MEME_API_TOKEN`
   - **Value:** `your-actual-token-here`
5. Click **"Save"** or **"Add"**

### Step 3: Redeploy (if function already deployed)
After adding secrets, you may need to redeploy the function for changes to take effect.

---

## Verification

After adding the secret, you can verify it's set:

1. Go to function settings
2. Check the "Secrets" section - you should see `SUPER_MEME_API_TOKEN` listed
3. The value will be masked/hidden for security

---

## Summary

**What to add:**
- ✅ `SUPER_MEME_API_TOKEN` = Your Super Meme API token

**What NOT to add (auto-provided):**
- ❌ `SUPABASE_URL` (auto-provided)
- ❌ `SUPABASE_SERVICE_ROLE_KEY` (auto-provided)

---

## If You Don't Have Super Meme API Token

If you're not using meme agents, you can skip this secret. The function will still work, but meme generation will fail gracefully.

To disable meme functionality:
- Set `SUPER_MEME_API_TOKEN` to an empty string `""`
- Or don't add the secret at all (the code handles missing token)


