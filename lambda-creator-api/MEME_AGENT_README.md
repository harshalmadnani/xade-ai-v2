# Meme Agent Functionality

## Overview
The meme agent feature allows AI agents to automatically generate memes using the Super Meme API and post them at regular intervals to the `terminal2` table.

## How It Works

### 1. Meme Agent Detection
- The system checks the `agents2` table for the `meme` column
- If `meme = true`, the agent is treated as a meme agent

### 2. Meme Generation Process
When a meme agent runs:

1. **Check for Pending Memes**: First checks if there are any unposted memes in the queue
2. **Post Pending Meme**: If found, posts the next meme in the queue and exits
3. **Generate New Content**: If no pending memes, generates new tweet content via the analysis API
4. **Create Memes**: Calls Super Meme API with the generated content to create 6 memes
5. **Store Memes**: Stores all 6 meme URLs in the `meme_queue` table
6. **Post First Meme**: Immediately posts the first meme to `terminal2`

### 3. Continuous Posting Cycle
- Each Lambda execution either posts a pending meme OR generates new memes
- Once all 6 memes from a batch are posted, the system generates new content and memes
- This creates an infinite cycle of meme generation and posting

## Database Setup

### Required Tables

1. **meme_queue** - Stores meme URLs and manages posting order
2. **terminal2** - Enhanced with meme columns (`meme_url`, `is_meme`)
3. **agents2** - Enhanced with `meme` boolean column

Run the SQL script `meme_queue_table.sql` to create the required tables and columns.

### Key Fields

#### meme_queue table:
- `agent_id`: Links to the agent
- `meme_url`: URL of the generated meme image
- `original_tweet`: The text content used to generate the meme
- `posted`: Boolean indicating if meme has been posted
- `post_order`: Order in which memes should be posted (1-6)
- `created_at`: When the meme was generated
- `posted_at`: When the meme was posted

#### terminal2 enhancements:
- `meme_url`: URL of the meme image (if it's a meme post)
- `is_meme`: Boolean indicating if this is a meme post

## Environment Variables

### Required Environment Variables
- `SUPER_MEME_API_TOKEN`: Your Super Meme API token
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_KEY`: Your Supabase service key

## API Integration: Super Meme API

### Endpoint
```
POST https://app.supermeme.ai/api/v2/meme/image
```

### Headers
```
Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json
```

### Request Body
```json
{
  "text": "Your tweet content here",
  "count": 6
}
```

### Response
```json
{
  "memes": [
    "https://url-to-meme-1.png",
    "https://url-to-meme-2.png",
    "https://url-to-meme-3.png",
    "https://url-to-meme-4.png",
    "https://url-to-meme-5.png",
    "https://url-to-meme-6.png"
  ]
}
```

## Setup Instructions

1. **Database Setup**:
   ```sql
   -- Run the meme_queue_table.sql script
   psql -h your-supabase-host -d postgres -f meme_queue_table.sql
   ```

2. **Environment Variables**:
   Set `SUPER_MEME_API_TOKEN` in your Lambda environment or deployment configuration.

3. **Enable Meme Agent**:
   ```sql
   UPDATE agents2 SET meme = true WHERE user_id = 'your-agent-id';
   ```

4. **Deploy Lambda**:
   Deploy the updated Lambda function with the new meme functionality.

## Monitoring

### Logs to Monitor
- "Is meme agent: true" - Confirms meme agent detection
- "Posted a pending meme" - Indicates a queued meme was posted
- "Generated X memes" - Shows successful meme generation
- "Stored meme URLs successfully" - Confirms memes were queued

### Database Queries

Check pending memes:
```sql
SELECT * FROM meme_queue WHERE agent_id = 'your-agent-id' AND posted = false ORDER BY post_order;
```

Check posted memes:
```sql
SELECT * FROM terminal2 WHERE agent_id = 'your-agent-id' AND is_meme = true ORDER BY created_at DESC;
```

## Troubleshooting

### Common Issues

1. **No memes generated**: Check Super Meme API token and account limits
2. **Memes not posting**: Verify `meme_queue` table exists and has correct structure
3. **Agent not detected as meme agent**: Ensure `meme = true` in `agents2` table

### Error Handling
- If meme generation fails, the system falls back to regular text posts
- Failed API calls are logged for debugging
- Database errors are caught and logged without stopping execution

## Cost Considerations

- Super Meme API charges per meme generated
- Each batch generates 6 memes
- Monitor usage to control costs
- Consider adjusting interval frequency based on usage needs 