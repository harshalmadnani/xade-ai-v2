const AWS = require('aws-sdk');
const { createClient } = require('@supabase/supabase-js');

// Initialize AWS services
const lambda = new AWS.Lambda();
const iam = new AWS.IAM();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async (event) => {
    // Parse request body
    const body = JSON.parse(event.body);
    const { userId, interval, query, systemPrompt } = body;
    
    if (!userId || !interval || !query || !systemPrompt) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Missing required parameters' })
        };
    }
    
    try {
        // Create a unique function name
        const functionName = `analysis-function-${userId}-${Date.now()}`;
        
        // Create the Lambda function code
        const functionCode = `
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    // Initialize Supabase client
    const supabase = createClient(
        '${supabaseUrl}',
        '${supabaseKey}'
    );
    
    try {
        // Call the analysis API
        const response = await axios.post('http://13.233.51.247:3004/api/analyze', {
            query: '${query.replace(/'/g, "\\'")}',
            systemPrompt: '${systemPrompt.replace(/'/g, "\\'")}'
        });
        
        // Store the result in Supabase
        const { data, error } = await supabase
            .from('terminal2')
            .insert([
                { 
                    agent_id: '${userId}',
                    tweet_content: response.data.result || JSON.stringify(response.data),
                    posted: false
                }
            ]);
            
        if (error) throw error;
        
        console.log('Analysis completed and stored successfully');
        return { success: true };
    } catch (error) {
        console.error('Error:', error);
        return { success: false, error: error.message };
    }
};`;

        // Create a deployment package
        const zipFile = await createDeploymentPackage(functionCode);
        
        // Get or create IAM role for Lambda
        const roleArn = await getOrCreateLambdaRole();
        
        // Create the Lambda function
        const createParams = {
            Code: {
                ZipFile: zipFile
            },
            FunctionName: functionName,
            Handler: 'index.handler',
            Role: roleArn,
            Runtime: 'nodejs16.x',
            Description: `Analysis function for user ${userId}`,
            Timeout: 30,
            Environment: {
                Variables: {
                    SUPABASE_URL: supabaseUrl,
                    SUPABASE_KEY: supabaseKey
                }
            }
        };
        
        const lambdaFunction = await lambda.createFunction(createParams).promise();
        
        // Set up CloudWatch Events to trigger the Lambda on schedule
        const eventbridge = new AWS.EventBridge();
        const ruleName = `${functionName}-rule`;
        
        // Create rule
        await eventbridge.putRule({
            Name: ruleName,
            ScheduleExpression: `rate(${interval} minutes)`,
            State: 'ENABLED'
        }).promise();
        
        // Add Lambda as target
        await eventbridge.putTargets({
            Rule: ruleName,
            Targets: [
                {
                    Id: `${ruleName}-target`,
                    Arn: lambdaFunction.FunctionArn
                }
            ]
        }).promise();
        
        // Add permission for EventBridge to invoke Lambda
        await lambda.addPermission({
            Action: 'lambda:InvokeFunction',
            FunctionName: functionName,
            Principal: 'events.amazonaws.com',
            SourceArn: `arn:aws:events:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:rule/${ruleName}`,
            StatementId: `${ruleName}-permission`
        }).promise();
        
        // Also invoke the Lambda immediately for first analysis
        await lambda.invoke({
            FunctionName: functionName,
            InvocationType: 'Event'
        }).promise();
        
        // Store function info in Supabase for tracking
        await supabase
            .from('lambda_functions')
            .insert([
                {
                    function_name: functionName,
                    user_id: userId,
                    interval: interval,
                    query: query,
                    system_prompt: systemPrompt,
                    created_at: new Date().toISOString()
                }
            ]);
        
        return {
            statusCode: 200,
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
            body: JSON.stringify({
                message: 'Error creating analysis function',
                error: error.message
            })
        };
    }
};

// Helper function to create deployment package
async function createDeploymentPackage(functionCode) {
    const JSZip = require('jszip');
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
        return roleData.Role.Arn;
    } catch (error) {
        if (error.code === 'NoSuchEntity') {
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
            
            // Wait for role to propagate
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            return role.Role.Arn;
        } else {
            throw error;
        }
    }
} 