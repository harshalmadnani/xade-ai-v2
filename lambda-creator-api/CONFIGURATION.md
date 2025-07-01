# Configuration Guide

## Environment Variables

### Required for Lambda Function

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key-here

# Super Meme API Configuration  
SUPER_MEME_API_TOKEN=your-super-meme-api-token-here

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=your-account-id
LAMBDA_EXECUTION_ROLE=arn:aws:iam::your-account:role/lambda-execution-role
```

### Required for Testing

Create a `.env` file in the `lambda-creator-api` directory with:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key-here
SUPER_MEME_API_TOKEN=your-super-meme-api-token-here
NODE_ENV=development
```

## Setup Steps

### 1. Database Setup

Run the SQL script to create required tables:

```sql
-- Connect to your Supabase database and run:
\i meme_queue_table.sql

-- Or manually execute the SQL commands from the file
```

### 2. Super Meme API Setup

1. Sign up at [Super Meme AI](https://app.supermeme.ai/)
2. Get your API token from the dashboard
3. Set the `SUPER_MEME_API_TOKEN` environment variable

### 3. Lambda Configuration

Add environment variables to your Lambda function:

```javascript
Environment: {
    Variables: {
        SUPABASE_URL: "https://your-project.supabase.co",
        SUPABASE_SERVICE_KEY: "your-service-key",
        SUPER_MEME_API_TOKEN: "your-super-meme-token"
    }
}
```

### 4. Agent Configuration

Enable meme functionality for specific agents:

```sql
UPDATE agents2 SET meme = true WHERE user_id = 'your-agent-id';
```

## Testing

Before deploying to production:

1. Install dependencies:
   ```bash
   npm install @supabase/supabase-js dotenv
   ```

2. Create `.env` file with your configuration

3. Run the test script:
   ```bash
   node test-meme-agent.js
   ```

## Deployment

After successful testing:

1. Update your Lambda function with the new code
2. Set environment variables in Lambda configuration
3. Deploy the function
4. Monitor CloudWatch logs for proper operation

## Monitoring

### CloudWatch Logs

Look for these log messages:
- `"Is meme agent: true"` - Confirms meme agent detection
- `"Generated X memes"` - Successful meme generation
- `"Posted a pending meme"` - Meme posted from queue

### Database Monitoring

Query pending memes:
```sql
SELECT COUNT(*) as pending_memes 
FROM meme_queue 
WHERE posted = false 
GROUP BY agent_id;
```

Query posted memes:
```sql
SELECT COUNT(*) as posted_memes
FROM terminal2 
WHERE is_meme = true 
AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY agent_id;
```

## Troubleshooting

### Common Issues

1. **"Super Meme API request failed"**
   - Check API token validity
   - Verify account has sufficient credits
   - Check API rate limits

2. **"meme_queue table error"**
   - Ensure SQL script was executed
   - Check table permissions
   - Verify Supabase connection

3. **"Agent not detected as meme agent"**
   - Confirm `meme = true` in agents2 table
   - Check user_id matches exactly
   - Verify agents2 table has meme column

### Error Codes

- `400`: Invalid request body or missing parameters
- `401`: Invalid Super Meme API token
- `429`: API rate limit exceeded
- `500`: Internal server error (check logs)

## Cost Management

### Super Meme API Costs
- Monitor API usage in dashboard
- Set up billing alerts
- Consider reducing meme count if needed (change from 6 to fewer)

### AWS Lambda Costs
- Monitor execution time and memory usage
- Consider adjusting timeout settings
- Review CloudWatch logs retention

## Security

### Best Practices
- Use IAM roles with minimal permissions
- Store sensitive tokens in environment variables
- Enable CloudWatch logging for monitoring
- Use Supabase RLS (Row Level Security) if needed 