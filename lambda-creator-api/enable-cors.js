// Enable CORS for API Gateway using AWS CLI commands
const { execSync } = require('child_process');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const API_ID = 'ieyyhrqs1h'; // Your API Gateway ID
const REGION = process.env.AWS_REGION || 'ap-south-1';

console.log('Enabling CORS for API Gateway...');

try {
    // Enable CORS for /agent/{agentId} resource
    console.log('Enabling CORS for /agent/{agentId} endpoint...');
    
    const corsCommand = `aws apigateway put-integration-response \\
        --rest-api-id ${API_ID} \\
        --resource-id lxbqx1 \\
        --http-method OPTIONS \\
        --status-code 200 \\
        --response-parameters '{"method.response.header.Access-Control-Allow-Headers":"'"'"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"'"'","method.response.header.Access-Control-Allow-Methods":"'"'"'GET,OPTIONS,POST'"'"'","method.response.header.Access-Control-Allow-Origin":"'"'"'*'"'"'}' \\
        --region ${REGION}`;
    
    execSync(corsCommand, { stdio: 'inherit' });
    
    console.log('CORS enabled successfully!');
    
    // Redeploy the API
    console.log('Redeploying API...');
    const deployCommand = `aws apigateway create-deployment --rest-api-id ${API_ID} --stage-name prod --region ${REGION}`;
    execSync(deployCommand, { stdio: 'inherit' });
    
    console.log('API redeployed with CORS support!');
    
} catch (error) {
    console.error('Failed to enable CORS:', error.message);
    console.log('Trying alternative approach - updating Lambda response headers...');
}

