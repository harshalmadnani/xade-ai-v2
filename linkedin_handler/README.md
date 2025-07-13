# LinkedIn Handler

A Node.js application that subscribes to the `terminal2` table and automatically posts content to LinkedIn when new entries are added.

## Features

- **Real-time subscription**: Listens to changes in the `terminal2` table via Supabase real-time
- **LinkedIn posting**: Posts content to LinkedIn using the UGC Posts API
- **Media handling**: Automatically detects and uploads images/videos from Supabase links
- **Status tracking**: Updates post status in the database (pending → processing → posted/failed)
- **Error handling**: Comprehensive error handling with detailed logging

## Setup

### Prerequisites

- Node.js (v14 or higher)
- Access to Supabase database
- LinkedIn API access token

### Installation

1. Navigate to the linkedin_handler directory:
```bash
cd linkedin_handler
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with the following variables:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
PORT=3001
```

### LinkedIn API Setup

1. **Create a LinkedIn App**:
   - Go to [LinkedIn Developer Portal](https://developer.linkedin.com/)
   - Create a new app
   - Add the "Share on LinkedIn" product to your app

2. **Get OAuth Token**:
   - Follow LinkedIn's OAuth 2.0 flow to get an access token
   - Required scopes: `w_member_social` (for personal posts) or `w_organization_social` (for company posts)

3. **Store Token in Database**:
   - Add the LinkedIn token to the `agents2` table in the `linkedin_token` column
   - Example:
   ```sql
   UPDATE agents2 SET linkedin_token = 'your_linkedin_access_token' WHERE id = 'agent_id';
   ```

## Usage

### Starting the Handler

```bash
# Production
npm start

# Development (with auto-restart)
npm run dev
```

The handler will:
1. Connect to Supabase and listen for changes in the `terminal2` table
2. Process new records with `status = 'pending'` or no status
3. Fetch LinkedIn credentials for the agent
4. Post content to LinkedIn (handling media if present)
5. Update the record status accordingly

### How It Works

1. **Database Subscription**: The handler subscribes to all changes in the `terminal2` table
2. **Content Processing**: When a new record is detected:
   - Extracts `agent_id` and `tweet_content`
   - Fetches LinkedIn token from `agents2` table
   - Checks for Supabase media links in the content
3. **LinkedIn Posting**: 
   - Uploads any media files to LinkedIn
   - Creates a UGC post with text and media
   - Posts to LinkedIn using their API
4. **Status Update**: Updates the database record with success/failure status

### Supported Media Types

- **Images**: JPG, PNG, GIF
- **Videos**: MP4, MOV, AVI

Media files are automatically detected if they contain "supabase" in the URL and are uploaded to LinkedIn before posting.

## Database Schema

The handler expects the following table structures:

### `terminal2` table:
- `id`: Primary key
- `agent_id`: Foreign key to agents2 table
- `tweet_content`: Text content to post
- `status`: Current status (pending, processing, posted, failed)
- `posted_at`: Timestamp when posted
- `error_message`: Error details if failed

### `agents2` table:
- `id`: Primary key
- `linkedin_token`: LinkedIn OAuth access token

## Error Handling

The handler includes comprehensive error handling:

- **Missing credentials**: Records are marked as failed if no LinkedIn token is found
- **API errors**: LinkedIn API errors are caught and logged
- **Media upload failures**: Individual media uploads can fail without stopping the post
- **Token expiration**: 401 errors are specifically logged as token issues

## Logging

The handler provides detailed console logging with emojis for easy identification:

- 🚀 Server startup
- 📨 Incoming database changes
- 🔗 LinkedIn credentials found
- 📝 Content processing
- 🎨 Media upload
- ✅ Success operations
- ❌ Error conditions

## Development

### Project Structure

```
linkedin_handler/
├── src/
│   └── index.js          # Main application file
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

### Testing

You can test the handler by:

1. Adding a record to the `terminal2` table:
```sql
INSERT INTO terminal2 (agent_id, tweet_content, status) 
VALUES ('your_agent_id', 'Test post content', 'pending');
```

2. Check the console logs for processing details
3. Verify the post appears on LinkedIn
4. Check that the record status is updated to 'posted'

## Troubleshooting

### Common Issues

1. **LinkedIn API 401 Unauthorized**:
   - Check if the LinkedIn token is valid and not expired
   - Ensure the token has the correct scopes

2. **Media upload failures**:
   - Verify the Supabase URLs are accessible
   - Check that the media file types are supported

3. **Database connection issues**:
   - Verify Supabase URL and service key are correct
   - Check network connectivity

### Debug Mode

For detailed debugging, the handler logs all request/response data. Monitor the console output for specific error details.

## Security Notes

- Store LinkedIn tokens securely in the database
- Use environment variables for sensitive configuration
- Ensure Supabase service key has appropriate permissions
- Consider token rotation policies for production use 