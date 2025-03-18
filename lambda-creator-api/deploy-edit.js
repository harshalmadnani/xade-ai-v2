// lambda-creator-api/deploy-edit.js
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dotenv = require('dotenv');

// Try to load environment variables from different possible .env locations
let envLoaded = false;

// Try current directory
try {
  const result = dotenv.config();
  if (!result.error) {
    envLoaded = true;
    console.log('Loaded .env from current directory');
  }
} catch (error) {
  // Ignore error and try next location
}

// Try parent directory if not loaded yet
if (!envLoaded) {
  try {
    const result = dotenv.config({ path: path.resolve(__dirname, '../.env') });
    if (!result.error) {
      envLoaded = true;
      console.log('Loaded .env from parent directory');
    }
  } catch (error) {
    // Ignore error and try next location
  }
}

// If still not loaded, use environment variables directly
if (!envLoaded) {
  console.log('No .env file found. Using environment variables directly.');
}

console.log('AWS_REGION:', process.env.AWS_REGION);

// Configure AWS SDK
AWS.config.update({ 
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const lambda = new AWS.Lambda();
const apigateway = new AWS.APIGateway();

// Add this check to ensure required environment variables are set
function checkRequiredEnvVars() {
    const required = [
        'AWS_REGION',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_LAMBDA_ROLE_ARN',
        'AWS_ACCOUNT_ID'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('Missing required environment variables:', missing.join(', '));
        console.error('Please check your .env file and ensure all required variables are set.');
        process.exit(1);
    }
}

// Add a sleep function to wait between retries
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function deploy() {
    try {
        console.log('Checking environment variables...');
        checkRequiredEnvVars();
        
        console.log('Preparing deployment...');
        
        // Create deployment package
        console.log('Creating deployment package...');
        execSync('zip -r edit-lambda-deployment.zip edit-lambda.js node_modules');
        
        const zipFile = fs.readFileSync('edit-lambda-deployment.zip');
        
        // Create or update Lambda function
        const functionName = 'edit-analysis-lambda-api';
        let functionArn;
        
        // Try to update the function with retries
        let retries = 3;
        let updateSuccess = false;
        
        while (retries > 0 && !updateSuccess) {
            try {
                // Try to update existing function
                console.log(`Updating Lambda function: ${functionName}`);
                const updateResult = await lambda.updateFunctionCode({
                    FunctionName: functionName,
                    ZipFile: zipFile
                }).promise();
                
                functionArn = updateResult.FunctionArn;
                console.log(`Updated Lambda function: ${functionArn}`);
                updateSuccess = true;
                
                // Wait for the update to complete before updating configuration
                console.log('Waiting for function update to complete...');
                await sleep(5000);
                
                // Update configuration
                await lambda.updateFunctionConfiguration({
                    FunctionName: functionName,
                    Environment: {
                        Variables: {
                            SUPABASE_URL: process.env.SUPABASE_URL,
                            SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
                            AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
                            LAMBDA_EXECUTION_ROLE: process.env.LAMBDA_EXECUTION_ROLE
                        }
                    },
                    Timeout: 60
                }).promise();
                
            } catch (error) {
                if (error.code === 'ResourceConflictException') {
                    retries--;
                    if (retries > 0) {
                        console.log(`Resource conflict detected. Waiting before retry... (${retries} retries left)`);
                        await sleep(10000); // Wait 10 seconds before retrying
                    } else {
                        console.error('Max retries reached. Could not update Lambda function due to ongoing updates.');
                        console.error('Please try again in a few minutes.');
                        process.exit(1);
                    }
                } else if (error.code === 'ResourceNotFoundException') {
                    // Function doesn't exist, create it
                    console.log(`Creating new Lambda function: ${functionName}`);
                    
                    const roleArn = process.env.LAMBDA_EXECUTION_ROLE || process.env.AWS_LAMBDA_ROLE_ARN;
                    console.log(`Using role ARN: ${roleArn}`);
                    
                    const createResult = await lambda.createFunction({
                        FunctionName: functionName,
                        Runtime: 'nodejs18.x',
                        Role: roleArn,
                        Handler: 'edit-lambda.handler',
                        Code: {
                            ZipFile: zipFile
                        },
                        Description: 'API to edit existing analysis Lambda functions',
                        Timeout: 60,
                        Environment: {
                            Variables: {
                                SUPABASE_URL: process.env.SUPABASE_URL,
                                SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
                                AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
                                LAMBDA_EXECUTION_ROLE: process.env.LAMBDA_EXECUTION_ROLE
                            }
                        }
                    }).promise();
                    
                    functionArn = createResult.FunctionArn;
                    console.log(`Created Lambda function: ${functionArn}`);
                    updateSuccess = true;
                } else {
                    throw error;
                }
            }
        }
        
        // Set up API Gateway
        console.log('Setting up API Gateway...');
        
        try {
            // Check if API exists
            const apis = await apigateway.getRestApis().promise();
            const api = apis.items.find(item => item.name === 'AnalysisLambdaAPI');
            
            if (!api) {
                console.error('API Gateway "AnalysisLambdaAPI" not found. Please create it first.');
                return;
            }
            
            const apiId = api.id;
            console.log(`Using existing API: ${apiId}`);
            
            // Get resources
            const resources = await apigateway.getResources({ restApiId: apiId }).promise();
            const rootResourceId = resources.items.find(item => item.path === '/').id;
            
            // Create resource if it doesn't exist
            let resourceId;
            const existingResource = resources.items.find(item => item.path === '/edit');
            
            if (existingResource) {
                resourceId = existingResource.id;
                console.log(`Using existing resource: ${resourceId}`);
            } else {
                // Create new resource
                const newResource = await apigateway.createResource({
                    restApiId: apiId,
                    parentId: rootResourceId,
                    pathPart: 'edit'
                }).promise();
                
                resourceId = newResource.id;
                console.log(`Created new resource: ${resourceId}`);
            }
            
            // Set up PUT method
            try {
                await apigateway.getMethod({
                    restApiId: apiId,
                    resourceId: resourceId,
                    httpMethod: 'PUT'
                }).promise();
                
                console.log('PUT method already exists, updating...');
                
                // Update integration
                await apigateway.putIntegration({
                    restApiId: apiId,
                    resourceId: resourceId,
                    httpMethod: 'PUT',
                    type: 'AWS_PROXY',
                    integrationHttpMethod: 'POST',
                    uri: `arn:aws:apigateway:${process.env.AWS_REGION}:lambda:path/2015-03-31/functions/${functionArn}/invocations`
                }).promise();
                
            } catch (error) {
                if (error.code === 'NotFoundException') {
                    // Create method
                    await apigateway.putMethod({
                        restApiId: apiId,
                        resourceId: resourceId,
                        httpMethod: 'PUT',
                        authorizationType: 'NONE'
                    }).promise();
                    
                    console.log('Created PUT method');
                    
                    // Create integration
                    await apigateway.putIntegration({
                        restApiId: apiId,
                        resourceId: resourceId,
                        httpMethod: 'PUT',
                        type: 'AWS_PROXY',
                        integrationHttpMethod: 'POST',
                        uri: `arn:aws:apigateway:${process.env.AWS_REGION}:lambda:path/2015-03-31/functions/${functionArn}/invocations`
                    }).promise();
                    
                    console.log('Created integration');
                } else {
                    throw error;
                }
            }
            
            // Add permission for API Gateway to invoke Lambda
            try {
                await lambda.addPermission({
                    FunctionName: functionName,
                    StatementId: `apigateway-invoke-edit-${Date.now()}`,
                    Action: 'lambda:InvokeFunction',
                    Principal: 'apigateway.amazonaws.com',
                    SourceArn: `arn:aws:execute-api:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${apiId}/*/*/edit`
                }).promise();
                
                console.log('Added permission for API Gateway to invoke Lambda');
            } catch (error) {
                if (error.code !== 'ResourceConflictException') {
                    throw error;
                }
                console.log('Permission already exists');
            }
            
            // Deploy API
            const deployment = await apigateway.createDeployment({
                restApiId: apiId,
                stageName: 'prod'
            }).promise();
            
            console.log(`Deployed API to stage: prod`);
            
            const apiUrl = `https://${apiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/prod/edit`;
            console.log(`API URL: ${apiUrl}`);
            
        } catch (error) {
            console.error('Error setting up API Gateway:', error);
            console.error('Lambda function was deployed successfully and can be used directly.');
            console.error('Lambda ARN:', functionArn);
        }
        
    } catch (error) {
        console.error('Deployment failed:', error);
    }
}

deploy();