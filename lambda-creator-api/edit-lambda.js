const AWS = require('aws-sdk');
const { createClient } = require('@supabase/supabase-js');
const JSZip = require('jszip');

// Initialize AWS services
const lambda = new AWS.Lambda();
const events = new AWS.CloudWatchEvents();

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
                'Access-Control-Allow-Methods': 'OPTIONS,PUT'
            },
            body: JSON.stringify({ message: 'Invalid request body' })
        };
    }
    
    const { functionName, userId, interval, query, systemPrompt } = body;
    
    if (!functionName || !userId) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,PUT'
            },
            body: JSON.stringify({ message: 'Missing required parameters: functionName and userId are required' })
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
                'Access-Control-Allow-Methods': 'OPTIONS,PUT'
            },
            body: JSON.stringify({ message: 'Missing Supabase configuration' })
        };
    }
    
    // Helper function to wait
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    try {
        // First, check if the function exists
        try {
            await lambda.getFunction({ FunctionName: functionName }).promise();
        } catch (error) {
            if (error.code === 'ResourceNotFoundException') {
                return {
                    statusCode: 404,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'OPTIONS,PUT'
                    },
                    body: JSON.stringify({ message: `Function ${functionName} not found` })
                };
            }
            throw error;
        }
        
        // If interval is provided, update the CloudWatch Events rule
        if (interval) {
            const ruleName = `${functionName}-schedule`;
            
            // Check if rule exists
            try {
                await events.describeRule({ Name: ruleName }).promise();
                
                // Update the rule schedule
                await events.putRule({
                    Name: ruleName,
                    ScheduleExpression: `rate(${interval} minutes)`,
                    State: 'ENABLED'
                }).promise();
                
                console.log(`Updated schedule for rule ${ruleName} to ${interval} minutes`);
            } catch (error) {
                if (error.code === 'ResourceNotFoundException') {
                    console.log(`Rule ${ruleName} not found, creating new rule`);
                    
                    // Create a new rule
                    await events.putRule({
                        Name: ruleName,
                        ScheduleExpression: `rate(${interval} minutes)`,
                        State: 'ENABLED'
                    }).promise();
                    
                    // Add the Lambda function as a target
                    await events.putTargets({
                        Rule: ruleName,
                        Targets: [
                            {
                                Id: '1',
                                Arn: `arn:aws:lambda:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:function:${functionName}`
                            }
                        ]
                    }).promise();
                    
                    // Add permission for CloudWatch Events to invoke the Lambda function
                    try {
                        await lambda.addPermission({
                            Action: 'lambda:InvokeFunction',
                            FunctionName: functionName,
                            Principal: 'events.amazonaws.com',
                            StatementId: `${ruleName}-permission`,
                            SourceArn: `arn:aws:events:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:rule/${ruleName}`
                        }).promise();
                    } catch (permError) {
                        // Ignore if permission already exists
                        if (permError.code !== 'ResourceConflictException') {
                            throw permError;
                        }
                    }
                } else {
                    throw error;
                }
            }
        }
        
        // If query or systemPrompt is provided, update the function code
        if (query || systemPrompt) {
            try {
                // Get the current function code
                const functionData = await lambda.getFunction({ FunctionName: functionName }).promise();
                
                // Download the current code
                const response = await fetch(functionData.Code.Location);
                const zipBuffer = await response.arrayBuffer();
                
                // Extract the code
                const zip = await JSZip.loadAsync(Buffer.from(zipBuffer));
                let functionCode = await zip.file('index.js').async('string');
                
                // Update the code with new query or systemPrompt if provided
                if (query) {
                    functionCode = functionCode.replace(
                        /query: '([^']+)'/,
                        `query: '${query.replace(/'/g, "\\'")}'`
                    );
                    
                    // Also update the console.log line
                    functionCode = functionCode.replace(
                        /console\.log\('Calling analysis API with query:', 'Make a tweet about([^']+)'\);/,
                        `console.log('Calling analysis API with query:', 'Make a tweet about${query.replace(/'/g, "\\'")}');`
                    );
                }
                
                if (systemPrompt) {
                    functionCode = functionCode.replace(
                        /const enhancedSystemPrompt = '([^']+)\\n If there is an error/,
                        `const enhancedSystemPrompt = '${systemPrompt.replace(/'/g, "\\'")}\\n If there is an error`
                    );
                }
                
                // Create a new zip file with the updated code
                const newZip = new JSZip();
                newZip.file('index.js', functionCode);
                
                // Generate the zip file
                const newZipBuffer = await newZip.generateAsync({
                    type: 'nodebuffer',
                    compression: 'DEFLATE',
                    compressionOptions: {
                        level: 9
                    }
                });
                
                // Update the function code
                let retries = 3;
                let updateSuccess = false;
                let updateError = null;
                
                while (retries > 0 && !updateSuccess) {
                    try {
                        await lambda.updateFunctionCode({
                            FunctionName: functionName,
                            ZipFile: newZipBuffer
                        }).promise();
                        updateSuccess = true;
                        console.log(`Updated Lambda function code: ${functionName}`);
                    } catch (error) {
                        updateError = error;
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
                
                if (!updateSuccess) {
                    console.error('Failed to update Lambda function code:', updateError);
                    return {
                        statusCode: 500,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'OPTIONS,PUT'
                        },
                        body: JSON.stringify({ 
                            message: 'Error updating Lambda function code', 
                            error: updateError.message,
                            note: "If this is a permissions error, please ensure the Lambda execution role has the necessary permissions (lambda:GetFunction, lambda:UpdateFunctionCode)"
                        })
                    };
                }
            } catch (error) {
                console.error('Error updating function code:', error);
                
                // Special handling for permission errors
                if (error.code === 'AccessDeniedException' || 
                    (error.message && error.message.includes('not authorized to perform'))) {
                    return {
                        statusCode: 403,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'OPTIONS,PUT'
                        },
                        body: JSON.stringify({ 
                            message: 'Permission denied. The Lambda function does not have sufficient permissions.',
                            error: error.message,
                            action: "Please update the IAM role with lambda:GetFunction and lambda:UpdateFunctionCode permissions"
                        })
                    };
                }
                
                return {
                    statusCode: 500,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'OPTIONS,PUT'
                    },
                    body: JSON.stringify({ 
                        message: 'Error updating Lambda function code', 
                        error: error.message 
                    })
                };
            }
        }
        
        // Invoke the function immediately to apply changes
        await lambda.invoke({
            FunctionName: functionName,
            InvocationType: 'Event'
        }).promise();
        
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,PUT'
            },
            body: JSON.stringify({
                message: 'Lambda function updated successfully',
                functionName,
                updates: {
                    interval: interval ? true : false,
                    query: query ? true : false,
                    systemPrompt: systemPrompt ? true : false
                }
            })
        };
        
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,PUT'
            },
            body: JSON.stringify({ 
                message: 'Error updating Lambda function', 
                error: error.message 
            })
        };
    }
}; 