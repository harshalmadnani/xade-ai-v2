// Update agent 135 Lambda function timeout to 5 minutes
const AWS = require('aws-sdk');
const dotenv = require('dotenv');

dotenv.config();

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const lambda = new AWS.Lambda();

async function updateAgent135Timeout() {
    try {
        const functionName = 'analysis-function-135';
        
        console.log(`Updating timeout for ${functionName} to 5 minutes (300 seconds)...`);
        
        const updateResult = await lambda.updateFunctionConfiguration({
            FunctionName: functionName,
            Timeout: 300
        }).promise();
        
        console.log('✅ Function timeout updated successfully!');
        console.log('New timeout:', updateResult.Timeout, 'seconds');
        console.log('Function ARN:', updateResult.FunctionArn);
        
    } catch (error) {
        console.error('❌ Failed to update function timeout:', error.message);
        if (error.code === 'ResourceNotFoundException') {
            console.error('The Lambda function does not exist. Please create it first.');
        }
    }
}

updateAgent135Timeout();

