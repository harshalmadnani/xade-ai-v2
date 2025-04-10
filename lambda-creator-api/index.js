const AWS = require('aws-sdk');
const { createClient } = require('@supabase/supabase-js');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Initialize AWS services
const lambda = new AWS.Lambda();
const iam = new AWS.IAM();
const eventbridge = new AWS.EventBridge();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async (event) => {
    // Parse request body
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (error) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST'
            },
            body: JSON.stringify({ message: 'Invalid request body' })
        };
    }
    
    const { userId, interval, query, systemPrompt } = body;
    
    if (!userId || !interval || !query || !systemPrompt) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST'
            },
            body: JSON.stringify({ message: 'Missing required parameters' })
        };
    }
    
    // Get Supabase credentials from environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST'
            },
            body: JSON.stringify({ message: 'Missing Supabase configuration' })
        };
    }
    
    const AWS = require('aws-sdk');
    const events = new AWS.CloudWatchEvents();
    
    // Helper function to wait
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    try {
        // Create a unique function name
        const functionName = `analysis-function-${userId}-${Date.now()}`;
        
        // Create the Lambda function code - using fetch instead of axios
        const functionCode = `
// Using native fetch instead of axios
exports.handler = async (event) => {
    console.log('Starting analysis function');
    
    // Supabase REST API implementation
    async function insertToSupabase(data) {
        try {
            const response = await fetch('${supabaseUrl}/rest/v1/terminal2', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': '${supabaseKey}',
                    'Authorization': 'Bearer ${supabaseKey}'
                },
                body: JSON.stringify([{
                    agent_id: '${userId}',
                    tweet_content: data,
                    posted: false,
                    created_at: new Date().toISOString()
                }])
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error('Supabase error: ' + errorText);
            }
            
            // Handle empty responses gracefully
            const responseText = await response.text();
            if (!responseText || responseText.trim() === '') {
                return { success: true };
            }
            
            // Only try to parse if there's actual content
            return JSON.parse(responseText);
        } catch (error) {
            console.error('Error in insertToSupabase:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Add function to get last 5 posts
    async function getLastFivePosts() {
        try {
            const response = await fetch('${supabaseUrl}/rest/v1/terminal2?agent_id=eq.${userId}&select=tweet_content&order=created_at.desc&limit=10', {
                method: 'GET',
                headers: {
                    'apikey': '${supabaseKey}',
                    'Authorization': 'Bearer ${supabaseKey}'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch posts');
            }

            const posts = await response.json();
            return posts.map(post => post.tweet_content).join('\\n');
        } catch (error) {
            console.error('Error fetching last posts:', error);
            return '';
        }
    }
    
    try {
        // Get last 5 posts before making the analysis call
        const lastPosts = await getLastFivePosts();
        const enhancedSystemPrompt = '${systemPrompt.replace(/'/g, "\\'")}\\n If there is an error in data, dont mention the error in your post and instead just tweet about somethig relevant to your character prompt. Dont repeat the content of your last 10 posts,Your last 10 posts are:\\n' + lastPosts;
        console.log('Calling analysis API with query:', 'Make a tweet about${query.replace(/'/g, "\\'")}');
        
        // Call the analysis API using fetch
        const response = await fetch('https://analyze-slaz.onrender.com/analyze', { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: '${query.replace(/'/g, "\\'")}',
                systemPrompt: enhancedSystemPrompt
                
            })
        });
        
        if (!response.ok) {
            throw new Error('API request failed with status: ' + response.status);
        }
        
        const data = await response.json();
        console.log('API response received:', JSON.stringify(data));
        
        // Store only the description from the result in Supabase
        let description;
        try {
            // Extract specifically the analysis field from the nested structure
            if (data && typeof data === 'object') {
                if (data.data && data.data.analysis) {
                    description = data.data.analysis;
                } else if (data.result && data.result.description) {
                    description = data.result.description;
                } else if (data.description) {
                    description = data.description;
                } else if (data.data && typeof data.data === 'string') {
                    description = data.data;
                } else if (data.result && typeof data.result === 'string') {
                    description = data.result;
                } else {
                    description = JSON.stringify(data);
                }
            } else {
                description = String(data);
            }
            
            // Ensure description is a string and not too large
            if (typeof description !== 'string') {
                description = JSON.stringify(description);
            }
            // Limit size if needed
            if (description.length > 10000) {
                description = description.substring(0, 10000) + '... (truncated)';
            }
        } catch (error) {
            console.error('Error processing description:', error);
            description = 'Error processing analysis result';
        }
        
        const result = await insertToSupabase(description);
        
        console.log('Analysis completed and stored successfully');
        return { success: true };
    } catch (error) {
        console.error('Error:', error);
        return { success: false, error: error.message };
    }
};`;

        // Use the predefined role ARN instead of trying to get or create one
        const roleArn = process.env.LAMBDA_EXECUTION_ROLE || process.env.AWS_LAMBDA_ROLE_ARN;
        
        if (!roleArn) {
            console.error('Available environment variables:', Object.keys(process.env));
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST'
                },
                body: JSON.stringify({ 
                    message: 'Error creating analysis function', 
                    error: 'Lambda execution role not configured' 
                })
            };
        }
        
        // Create a proper zip file using JSZip
        const zip = new JSZip();
        zip.file('index.js', functionCode);
        
        // Generate the zip file
        const zipBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: {
                level: 9
            }
        });
        
        // Create the Lambda function with retries
        const createParams = {
            Code: {
                ZipFile: zipBuffer
            },
            FunctionName: functionName,
            Handler: 'index.handler',
            Role: roleArn,
            Runtime: 'nodejs18.x', // Using Node.js 18 which has fetch built-in
            Description: `Analysis function for user ${userId}`,
            Timeout: 30,
            Environment: {
                Variables: {
                    SUPABASE_URL: supabaseUrl,
                    SUPABASE_KEY: supabaseKey
                }
            }
        };
        
        // Try to create the function with retries
        let retries = 3;
        let functionCreated = false;
        let createError = null;
        
        while (retries > 0 && !functionCreated) {
            try {
                await lambda.createFunction(createParams).promise();
                functionCreated = true;
                console.log(`Created Lambda function: ${functionName}`);
            } catch (error) {
                createError = error;
                if (error.code === 'ResourceConflictException' && error.message.includes('Pending')) {
                    retries--;
                    console.log(`Function is in Pending state. Waiting before retry... (${retries} retries left)`);
                    await sleep(5000); // Wait 5 seconds before retrying
                } else {
                    // For other errors, don't retry
                    break;
                }
            }
        }
        
        if (!functionCreated) {
            console.error('Failed to create Lambda function:', createError);
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST'
                },
                body: JSON.stringify({ 
                    message: 'Error creating analysis function', 
                    error: createError.message 
                })
            };
        }
        
        // Create a CloudWatch Events rule to trigger the function on a schedule
        const ruleName = `${functionName}-schedule`;
        const ruleParams = {
            Name: ruleName,
            ScheduleExpression: `rate(${interval} minutes)`,
            State: 'ENABLED'
        };
        
        await events.putRule(ruleParams).promise();
        
        // Add the Lambda function as a target for the rule
        const targetParams = {
            Rule: ruleName,
            Targets: [
                {
                    Id: '1',
                    Arn: `arn:aws:lambda:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:function:${functionName}`
                }
            ]
        };
        
        await events.putTargets(targetParams).promise();
        
        // Add permission for CloudWatch Events to invoke the Lambda function
        const permissionParams = {
            Action: 'lambda:InvokeFunction',
            FunctionName: functionName,
            Principal: 'events.amazonaws.com',
            StatementId: `${ruleName}-permission`,
            SourceArn: `arn:aws:events:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:rule/${ruleName}`
        };
        
        await lambda.addPermission(permissionParams).promise();
        
        // Invoke the function immediately for a first run
        await lambda.invoke({
            FunctionName: functionName,
            InvocationType: 'Event'
        }).promise();
        
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST'
            },
            body: JSON.stringify({
                message: 'Analysis function created and scheduled successfully',
                functionName,
                interval,
                userId
            })
        };
        
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST'
            },
            body: JSON.stringify({ 
                message: 'Error creating analysis function', 
                error: error.message 
            })
        };
    }
};

// Helper function to create deployment package
async function createDeploymentPackage(functionCode) {
    const zip = new JSZip();
    
    // Add the function code
    zip.file('index.js', functionCode);
    
    // Add package.json
    zip.file('package.json', JSON.stringify({
        name: "analysis-function",
        version: "1.0.0",
        description: "Lambda function for periodic analysis",
        main: "index.js",
        dependencies: {
            "axios": "^0.27.2",
            "@supabase/supabase-js": "^2.0.0"
        }
    }));
    
    // Generate the zip file
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    return zipBuffer;
}

// Helper function to get or create IAM role
async function getOrCreateLambdaRole() {
    const roleName = 'analysis-lambda-role';
    
    try {
        const roleData = await iam.getRole({ RoleName: roleName }).promise();
        console.log(`Using existing role: ${roleData.Role.Arn}`);
        return roleData.Role.Arn;
    } catch (error) {
        if (error.code === 'NoSuchEntity') {
            console.log(`Creating new role: ${roleName}`);
            // Create the role
            const assumeRolePolicy = {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: { Service: 'lambda.amazonaws.com' },
                    Action: 'sts:AssumeRole'
                }]
            };
            
            const role = await iam.createRole({
                RoleName: roleName,
                AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicy)
            }).promise();
            
            // Attach necessary policies
            await iam.attachRolePolicy({
                RoleName: roleName,
                PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
            }).promise();
            
            // Add custom policy for Supabase access
            const policyDocument = {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Action: [
                        'logs:CreateLogGroup',
                        'logs:CreateLogStream',
                        'logs:PutLogEvents'
                    ],
                    Resource: 'arn:aws:logs:*:*:*'
                }]
            };
            
            await iam.putRolePolicy({
                RoleName: roleName,
                PolicyName: 'lambda-execution-policy',
                PolicyDocument: JSON.stringify(policyDocument)
            }).promise();
            
            // Wait for role to propagate
            console.log('Waiting for role to propagate...');
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            console.log(`Created role: ${role.Role.Arn}`);
            return role.Role.Arn;
        } else {
            throw error;
        }
    }
}