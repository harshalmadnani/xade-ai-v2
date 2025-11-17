# Backend Proxy for Lambda Function URLs

Since your Lambda Function URLs use AWS_IAM authentication, you need a backend proxy to handle the signed requests.

## Quick Setup

### 1. Add to Existing Backend (Recommended)

```javascript
const AWS = require('aws-sdk');
const https = require('https');

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Function to call Lambda Function URL with signed request
async function callLambdaFunctionUrl(functionUrl, payload) {
    const url = new URL(functionUrl);
    
    const endpoint = new AWS.Endpoint(functionUrl);
    const request = new AWS.HttpRequest(endpoint, AWS.config.region);
    
    request.method = 'POST';
    request.headers['Content-Type'] = 'application/json';
    request.headers['Host'] = url.hostname;
    request.body = JSON.stringify(payload);
    
    // Sign the request
    const signer = new AWS.Signers.V4(request, 'lambda');
    signer.addAuthorization(AWS.config.credentials, new Date());
    
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: request.method,
            headers: request.headers
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });
        
        req.on('error', reject);
        req.write(request.body);
        req.end();
    });
}

// Add this route to your existing Express app
app.post('/api/agent/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const payload = req.body;
        
        // Get Function URL from your database or config
        const functionUrl = await getFunctionUrlForAgent(agentId);
        
        if (!functionUrl) {
            return res.status(404).json({ error: 'Agent not found' });
        }
        
        // Call the Lambda Function URL
        const result = await callLambdaFunctionUrl(functionUrl, payload);
        res.json(result);
        
    } catch (error) {
        console.error('Error calling agent:', error);
        res.status(500).json({ error: 'Failed to call agent' });
    }
});
```

### 2. Frontend Usage

```javascript
// Simple fetch call from your frontend
const callAgent = async (agentId, message) => {
    const response = await fetch(`/api/agent/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, user_id: currentUser.id })
    });
    return await response.json();
};
```

### 3. Environment Variables

Make sure your backend has these environment variables:

```bash
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

## Alternative: Direct AWS SDK Usage

If you prefer, you can also use the AWS SDK directly in your backend without the manual signing:

```javascript
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();

// Invoke Lambda function directly (alternative approach)
app.post('/api/agent/:agentId', async (req, res) => {
    try {
        const params = {
            FunctionName: `analysis-function-${agentId}`,
            Payload: JSON.stringify(req.body)
        };
        
        const result = await lambda.invoke(params).promise();
        const response = JSON.parse(result.Payload);
        res.json(response);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

## Security Notes

- ✅ AWS credentials stay on backend (never exposed to frontend)
- ✅ Can add rate limiting, authentication, logging
- ✅ Function URLs remain secure with AWS_IAM authentication
- ✅ Frontend makes simple HTTP calls without AWS complexity

Choose the approach that best fits your existing architecture!



