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
        execSync('zip -r deployment.zip index.js node_modules');
        
        const zipFile = fs.readFileSync('deployment.zip');
        
        // Create or update Lambda function with a NEW NAME
        const functionName = 'create-analysis-lambda-api-latest'; // Changed function name
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
                await sleep(5000); // Wait 5 seconds
                
                // Update configuration - AWS_REGION is automatically provided by Lambda
                await lambda.updateFunctionConfiguration({
                    FunctionName: functionName,
                    Environment: {
                        Variables: {
                            SUPABASE_URL: process.env.SUPABASE_URL,
                            SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
                            AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
                            LAMBDA_EXECUTION_ROLE: process.env.LAMBDA_EXECUTION_ROLE,
                            SUPER_MEME_API_TOKEN: process.env.SUPER_MEME_API_TOKEN || 'q2hdfDvhsm+QWr2mtjEgAb5xfe8='
                        }
                    },
                    Timeout: 300
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
                    
                    // Use LAMBDA_EXECUTION_ROLE instead of AWS_LAMBDA_ROLE_ARN
                    const roleArn = process.env.LAMBDA_EXECUTION_ROLE || process.env.AWS_LAMBDA_ROLE_ARN;
                    console.log(`Using role ARN: ${roleArn}`);
                    
                    const createResult = await lambda.createFunction({
                        FunctionName: functionName,
                        Runtime: 'nodejs16.x',
                        Role: roleArn,
                        Handler: 'index.handler',
                        Code: {
                            ZipFile: zipFile
                        },
                        Description: 'API to create analysis Lambda functions',
                        Timeout: 300,
                        Environment: {
                            Variables: {
                                SUPABASE_URL: process.env.SUPABASE_URL,
                                SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
                                AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
                                LAMBDA_EXECUTION_ROLE: process.env.LAMBDA_EXECUTION_ROLE,
                                SUPER_MEME_API_TOKEN: process.env.SUPER_MEME_API_TOKEN || 'q2hdfDvhsm+QWr2mtjEgAb5xfe8='
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
        
        // Create or update API Gateway - wrapped in try/catch to handle permission issues
        console.log('Setting up API Gateway...');
        
        try {
            // Check if API exists
            let apiId;
            try {
                const apis = await apigateway.getRestApis().promise();
                const api = apis.items.find(item => item.name === 'AnalysisLambdaAPI');
                
                if (api) {
                    apiId = api.id;
                    console.log(`Using existing API: ${apiId}`);
                } else {
                    // Create new API
                    const newApi = await apigateway.createRestApi({
                        name: 'AnalysisLambdaAPI',
                        description: 'API for creating analysis Lambda functions'
                    }).promise();
                    
                    apiId = newApi.id;
                    console.log(`Created new API: ${apiId}`);
                }
                
                // Get root resource ID
                const resources = await apigateway.getResources({ restApiId: apiId }).promise();
                const rootResourceId = resources.items.find(item => item.path === '/').id;
                
                // Create /create resource if it doesn't exist
                let createResourceId;
                const existingCreateResource = resources.items.find(item => item.path === '/create');
                
                if (existingCreateResource) {
                    createResourceId = existingCreateResource.id;
                    console.log(`Using existing /create resource: ${createResourceId}`);
                } else {
                    // Create new /create resource
                    const newResource = await apigateway.createResource({
                        restApiId: apiId,
                        parentId: rootResourceId,
                        pathPart: 'create'
                    }).promise();
                    
                    createResourceId = newResource.id;
                    console.log(`Created new /create resource: ${createResourceId}`);
                }
                
                // Create /agent resource if it doesn't exist
                let agentResourceId;
                const existingAgentResource = resources.items.find(item => item.path === '/agent');
                
                if (existingAgentResource) {
                    agentResourceId = existingAgentResource.id;
                    console.log(`Using existing /agent resource: ${agentResourceId}`);
                } else {
                    // Create new /agent resource
                    const newAgentResource = await apigateway.createResource({
                        restApiId: apiId,
                        parentId: rootResourceId,
                        pathPart: 'agent'
                    }).promise();
                    
                    agentResourceId = newAgentResource.id;
                    console.log(`Created new /agent resource: ${agentResourceId}`);
                }
                
                // Create /agent/{agentId} resource if it doesn't exist
                let agentIdResourceId;
                const existingAgentIdResource = resources.items.find(item => item.path === '/agent/{agentId}');
                
                if (existingAgentIdResource) {
                    agentIdResourceId = existingAgentIdResource.id;
                    console.log(`Using existing /agent/{agentId} resource: ${agentIdResourceId}`);
                } else {
                    // Create new /agent/{agentId} resource
                    const newAgentIdResource = await apigateway.createResource({
                        restApiId: apiId,
                        parentId: agentResourceId,
                        pathPart: '{agentId}'
                    }).promise();
                    
                    agentIdResourceId = newAgentIdResource.id;
                    console.log(`Created new /agent/{agentId} resource: ${agentIdResourceId}`);
                }
                
                // Helper function to setup POST method for a resource
                async function setupPostMethod(resourceId, resourceName) {
                    try {
                        await apigateway.getMethod({
                            restApiId: apiId,
                            resourceId: resourceId,
                            httpMethod: 'POST'
                        }).promise();
                        
                        console.log(`POST method already exists for ${resourceName}, updating...`);
                        
                        // Update integration
                        await apigateway.putIntegration({
                            restApiId: apiId,
                            resourceId: resourceId,
                            httpMethod: 'POST',
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
                                httpMethod: 'POST',
                                authorizationType: 'NONE'
                            }).promise();
                            
                            console.log(`Created POST method for ${resourceName}`);
                            
                            // Create integration
                            await apigateway.putIntegration({
                                restApiId: apiId,
                                resourceId: resourceId,
                                httpMethod: 'POST',
                                type: 'AWS_PROXY',
                                integrationHttpMethod: 'POST',
                                uri: `arn:aws:apigateway:${process.env.AWS_REGION}:lambda:path/2015-03-31/functions/${functionArn}/invocations`
                            }).promise();
                            
                            console.log(`Created integration for ${resourceName}`);
                        } else {
                            throw error;
                        }
                    }
                }
                
                // Helper function to setup OPTIONS method for CORS
                async function setupOptionsMethod(resourceId, resourceName) {
                    try {
                        await apigateway.getMethod({
                            restApiId: apiId,
                            resourceId: resourceId,
                            httpMethod: 'OPTIONS'
                        }).promise();
                        
                        console.log(`OPTIONS method already exists for ${resourceName}`);
                        
                    } catch (error) {
                        if (error.code === 'NotFoundException') {
                            // Create OPTIONS method
                            await apigateway.putMethod({
                                restApiId: apiId,
                                resourceId: resourceId,
                                httpMethod: 'OPTIONS',
                                authorizationType: 'NONE'
                            }).promise();
                            
                            console.log(`Created OPTIONS method for ${resourceName}`);
                            
                            // Create integration for OPTIONS
                            await apigateway.putIntegration({
                                restApiId: apiId,
                                resourceId: resourceId,
                                httpMethod: 'OPTIONS',
                                type: 'AWS_PROXY',
                                integrationHttpMethod: 'POST',
                                uri: `arn:aws:apigateway:${process.env.AWS_REGION}:lambda:path/2015-03-31/functions/${functionArn}/invocations`
                            }).promise();
                            
                            console.log(`Created OPTIONS integration for ${resourceName}`);
                        } else {
                            throw error;
                        }
                    }
                }
                
                // Set up POST method for /create endpoint
                await setupPostMethod(createResourceId, '/create');
                await setupOptionsMethod(createResourceId, '/create');
                
                // Set up POST method for /agent/{agentId} endpoint
                await setupPostMethod(agentIdResourceId, '/agent/{agentId}');
                await setupOptionsMethod(agentIdResourceId, '/agent/{agentId}');
                
                // Add permissions for API Gateway to invoke Lambda
                const permissions = [
                    {
                        statementId: `apigateway-invoke-create-${Date.now()}`,
                        sourceArn: `arn:aws:execute-api:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${apiId}/*/*/create`,
                        description: '/create endpoint'
                    },
                    {
                        statementId: `apigateway-invoke-agent-${Date.now()}`,
                        sourceArn: `arn:aws:execute-api:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:${apiId}/*/*/agent/*`,
                        description: '/agent/{agentId} endpoint'
                    }
                ];
                
                for (const permission of permissions) {
                    try {
                        await lambda.addPermission({
                            FunctionName: functionName,
                            StatementId: permission.statementId,
                            Action: 'lambda:InvokeFunction',
                            Principal: 'apigateway.amazonaws.com',
                            SourceArn: permission.sourceArn
                        }).promise();
                        
                        console.log(`Added permission for API Gateway to invoke Lambda - ${permission.description}`);
                    } catch (error) {
                        if (error.code !== 'ResourceConflictException') {
                            throw error;
                        }
                        console.log(`Permission already exists for ${permission.description}`);
                    }
                }
                
                // Deploy API
                const deployment = await apigateway.createDeployment({
                    restApiId: apiId,
                    stageName: 'prod'
                }).promise();
                
                console.log(`Deployed API to stage: prod`);
                
                const baseUrl = `https://${apiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/prod`;
                console.log(`API Base URL: ${baseUrl}`);
                console.log(`Create Endpoint: ${baseUrl}/create`);
                console.log(`Agent Proxy Endpoint: ${baseUrl}/agent/{agentId}`);
                
            } catch (error) {
                if (error.code === 'AccessDeniedException') {
                    console.error('Error: Your AWS user does not have permission to manage API Gateway.');
                    console.error('Please add the "AmazonAPIGatewayAdministrator" policy to your IAM user or use a user with appropriate permissions.');
                    console.error('You can still use the Lambda function directly at:', functionArn);
                    return; // Exit the function but don't throw an error
                } else {
                    throw error; // Re-throw other errors
                }
            }
            
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