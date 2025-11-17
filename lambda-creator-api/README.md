# Lambda Creator API - Vercel Edition

This project has been migrated from AWS Lambda to Vercel + Supabase Edge Functions.

## Quick Start

1. **Run Database Migration**
   ```sql
   -- Execute migrate_to_vercel.sql in Supabase SQL editor
   ```

2. **Deploy Supabase Edge Function**
   ```bash
   supabase functions deploy execute-agent --project-ref YOUR_PROJECT_REF
   supabase secrets set SUPER_MEME_API_TOKEN=your-token --project-ref YOUR_PROJECT_REF
   ```

3. **Deploy to Vercel**
   ```bash
   vercel deploy
   ```

4. **Set Environment Variables in Vercel**
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `SUPABASE_EDGE_FUNCTION_URL`
   - `SUPER_MEME_API_TOKEN`
   - `CRON_SECRET`

## Project Structure

```
lambda-creator-api/
├── api/                      # Vercel API routes
│   ├── create.js            # Create/update agent config
│   ├── agent/
│   │   └── [agentId].js     # Execute agent via Edge Function
│   └── cron.js               # Cron job (runs every minute)
├── supabase/
│   └── functions/
│       └── execute-agent/   # Supabase Edge Function
│           └── index.ts     # Heavy processing logic
├── vercel.json               # Vercel configuration (cron jobs)
├── migrate_to_vercel.sql     # Database migration script
└── VERCEL_MIGRATION.md       # Detailed migration guide
```

## API Endpoints

- `POST /api/create` - Create/update agent configuration
- `POST /api/agent/[agentId]` - Execute agent
- `GET /api/cron` - Cron job (auto-called by Vercel)

## Documentation

- [VERCEL_MIGRATION.md](./VERCEL_MIGRATION.md) - Complete migration guide
- [CONFIGURATION.md](./CONFIGURATION.md) - Configuration reference (legacy AWS info)

## Testing

```bash
# Set test environment variables
export TEST_USER_ID=your-agent-id
export VERCEL_URL=your-app.vercel.app

# Run tests
node test-vercel-routes.js
```

## Differences from AWS Lambda

- ✅ No AWS account needed
- ✅ Simpler deployment
- ✅ Built-in cron jobs
- ⚠️ Vercel Hobby: 10s timeout (Pro: 60s)
- ⚠️ Supabase Edge Functions: 60s timeout

See [VERCEL_MIGRATION.md](./VERCEL_MIGRATION.md) for full details.


