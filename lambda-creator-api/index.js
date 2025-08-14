const AWS = require('aws-sdk');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Initialize AWS services with region configuration
AWS.config.update({
    region: process.env.AWS_REGION || 'us-east-1'
});

const lambda = new AWS.Lambda();
const iam = new AWS.IAM();
const eventbridge = new AWS.EventBridge();

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

// Helper function to make HTTPS requests
function httpsRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const result = {
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        data: res.statusCode >= 200 && res.statusCode < 300 ? JSON.parse(data) : data
                    };
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(options.body);
        }
        
        req.end();
    });
}

// Simple CRC32 calculation
function crc32(buffer) {
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        crcTable[n] = c;
    }
    
    let crc = 0 ^ (-1);
    for (let i = 0; i < buffer.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
}

// Simple ZIP creator for Lambda functions
function createZipBuffer(filename, content) {
    // Create a minimal ZIP file structure
    const fileContent = Buffer.from(content, 'utf8');
    const fileHeader = Buffer.alloc(30 + filename.length);
    const centralDir = Buffer.alloc(46 + filename.length);
    const endRecord = Buffer.alloc(22);
    
    // Local file header
    fileHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    fileHeader.writeUInt16LE(20, 4); // Version needed to extract
    fileHeader.writeUInt16LE(0, 6); // General purpose bit flag
    fileHeader.writeUInt16LE(0, 8); // Compression method (0 = no compression)
    fileHeader.writeUInt16LE(0, 10); // File last modification time
    fileHeader.writeUInt16LE(0, 12); // File last modification date
    fileHeader.writeUInt32LE(0, 14); // CRC-32 (we'll calculate this)
    fileHeader.writeUInt32LE(fileContent.length, 18); // Compressed size
    fileHeader.writeUInt32LE(fileContent.length, 22); // Uncompressed size
    fileHeader.writeUInt16LE(filename.length, 26); // File name length
    fileHeader.writeUInt16LE(0, 28); // Extra field length
    fileHeader.write(filename, 30); // File name
    
    // Calculate CRC32
    const crc32Value = crc32(fileContent);
    fileHeader.writeUInt32LE(crc32Value, 14);
    
    // Central directory header
    centralDir.writeUInt32LE(0x02014b50, 0); // Central file header signature
    centralDir.writeUInt16LE(20, 4); // Version made by
    centralDir.writeUInt16LE(20, 6); // Version needed to extract
    centralDir.writeUInt16LE(0, 8); // General purpose bit flag
    centralDir.writeUInt16LE(0, 10); // Compression method
    centralDir.writeUInt16LE(0, 12); // File last modification time
    centralDir.writeUInt16LE(0, 14); // File last modification date
    centralDir.writeUInt32LE(crc32Value, 16); // CRC-32
    centralDir.writeUInt32LE(fileContent.length, 20); // Compressed size
    centralDir.writeUInt32LE(fileContent.length, 24); // Uncompressed size
    centralDir.writeUInt16LE(filename.length, 28); // File name length
    centralDir.writeUInt16LE(0, 30); // Extra field length
    centralDir.writeUInt16LE(0, 32); // File comment length
    centralDir.writeUInt16LE(0, 34); // Disk number start
    centralDir.writeUInt16LE(0, 36); // Internal file attributes
    centralDir.writeUInt32LE(0, 38); // External file attributes
    centralDir.writeUInt32LE(0, 42); // Relative offset of local header
    centralDir.write(filename, 46); // File name
    
    // End of central directory record
    endRecord.writeUInt32LE(0x06054b50, 0); // End of central dir signature
    endRecord.writeUInt16LE(0, 4); // Number of this disk
    endRecord.writeUInt16LE(0, 6); // Number of the disk with start of central directory
    endRecord.writeUInt16LE(1, 8); // Total number of entries in central directory on this disk
    endRecord.writeUInt16LE(1, 10); // Total number of entries in central directory
    endRecord.writeUInt32LE(centralDir.length, 12); // Size of central directory
    endRecord.writeUInt32LE(fileHeader.length + fileContent.length, 16); // Offset of start of central directory
    endRecord.writeUInt16LE(0, 20); // ZIP file comment length
    
    return Buffer.concat([fileHeader, fileContent, centralDir, endRecord]);
}

// Function to call Lambda Function URL with AWS_IAM signed request
async function callLambdaFunctionUrl(functionUrl, payload) {
    const url = new URL(functionUrl);
    
    // Create AWS request
    const endpoint = new AWS.Endpoint(functionUrl);
    const request = new AWS.HttpRequest(endpoint, AWS.config.region);
    
    request.method = 'POST';
    request.headers['Content-Type'] = 'application/json';
    request.headers['Host'] = url.hostname;
    request.body = JSON.stringify(payload);
    
    // Sign the request with AWS credentials
    const signer = new AWS.Signers.V4(request, 'lambda');
    signer.addAuthorization(AWS.config.credentials, new Date());
    
    // Make the HTTPS request
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
                    const result = {
                        statusCode: res.statusCode,
                        body: JSON.parse(data)
                    };
                    resolve(result);
                } catch (parseError) {
                    resolve({
                        statusCode: res.statusCode,
                        body: data
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(new Error(`Request failed: ${error.message}`));
        });
        
        req.write(request.body);
        req.end();
    });
}

// Function to get Function URL for an agent from Supabase
async function getFunctionUrlForAgent(agentId) {
    try {
        // Query Supabase to get agent_trigger (which contains the function URL) for this agent
        const url = `${supabaseUrl}/rest/v1/agents2?id=eq.${agentId}&select=agent_trigger`;
        
        const response = await httpsRequest(url, {
            method: 'GET',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.status >= 200 && response.status < 300 && response.data.length > 0) {
            return response.data[0].agent_trigger;
        }
        
        return null;
    } catch (error) {
        console.error('Error fetching function URL for agent:', error);
        return null;
    }
}

exports.handler = async (event) => {
    console.log('Starting Lambda creator API');
    console.log('Event:', JSON.stringify(event, null, 2));
    
    try {
        // Parse the request path to determine which endpoint was called
        const path = event.path || event.requestContext?.path || '/create';
        const httpMethod = event.httpMethod || event.requestContext?.httpMethod || 'POST';
        
        console.log('Request path:', path, 'Method:', httpMethod);
        
        // CORS headers for all responses
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
            'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
            'Access-Control-Max-Age': '86400'
        };
        
        // Handle CORS preflight requests
        if (httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: ''
            };
        }
        
        // Handle proxy endpoint for calling agents
        if (path.startsWith('/agent/') && httpMethod === 'POST') {
            const agentId = path.split('/')[2]; // Extract agentId from /agent/{agentId}
            
            if (!agentId) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'Missing agentId in path' })
                };
            }
            
            let body;
            try {
                body = JSON.parse(event.body || '{}');
                console.log(`📞 Calling agent ${agentId} with payload:`, body);
            } catch (parseError) {
                console.error('Failed to parse request body for agent call:', parseError.message);
                console.error('Raw event.body:', event.body);
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        error: 'Invalid JSON in request body',
                        details: parseError.message 
                    })
                };
            }
            
            // Get Function URL for this agent
            const functionUrl = await getFunctionUrlForAgent(agentId);
            
            if (!functionUrl) {
                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        error: 'Agent not found or no function URL configured',
                        agent_id: agentId
                    })
                };
            }
            
            try {
                // Add metadata to payload
                const enrichedPayload = {
                    ...body,
                    metadata: {
                        timestamp: new Date().toISOString(),
                        source: 'lambda-proxy',
                        agent_id: agentId
                    }
                };
                
                // Call the Lambda Function URL
                const result = await callLambdaFunctionUrl(functionUrl, enrichedPayload);
                
                console.log(`✅ Agent ${agentId} responded with status ${result.statusCode}`);
                
                // Return the response
                if (result.statusCode === 200) {
                    return {
                        statusCode: 200,
                        headers: corsHeaders,
                        body: JSON.stringify({
                            success: true,
                            agent_id: agentId,
                            data: result.body,
                            metadata: {
                                response_time: new Date().toISOString(),
                                function_url: functionUrl
                            }
                        })
                    };
                } else {
                    return {
                        statusCode: result.statusCode,
                        headers: corsHeaders,
                        body: JSON.stringify({
                            success: false,
                            agent_id: agentId,
                            error: result.body,
                            status_code: result.statusCode
                        })
                    };
                }
                
            } catch (error) {
                console.error(`❌ Error calling agent ${agentId}:`, error);
                
                return {
                    statusCode: 500,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        success: false,
                        error: 'Internal server error',
                        message: error.message,
                        agent_id: agentId
                    })
                };
            }
        }
        
        // Handle the original /create endpoint
        if (path === '/create' || path === '/' || !path.startsWith('/agent/')) {
            // Parse request body
            let body;
            try {
                body = JSON.parse(event.body || '{}');
                console.log('📋 Create endpoint request body:', body);
            } catch (parseError) {
                console.error('Failed to parse request body for create:', parseError.message);
                console.error('Raw event.body:', event.body);
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        error: 'Invalid JSON in request body',
                        details: parseError.message 
                    })
                };
            }
            const { userId } = body;
        
        if (!userId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Missing required parameter: userId' })
            };
        }
        
        console.log('Step 1: Request parsed successfully, userId:', userId);
        
        // Check environment variables
        if (!supabaseUrl || !supabaseKey) {
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Missing Supabase configuration' })
            };
        }
        
        console.log('Step 2: Environment variables validated');
        
        // Check if agent already exists
        console.log('Step 2.5: Checking if agent already exists...');
        try {
            const checkUrl = `${supabaseUrl}/rest/v1/agents2?id=eq.${userId}&select=id,agent_trigger`;
            
            const checkResponse = await httpsRequest(checkUrl, {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (checkResponse.status >= 200 && checkResponse.status < 300 && checkResponse.data.length > 0) {
                const existingAgent = checkResponse.data[0];
                if (existingAgent.agent_trigger) {
                    // Agent already exists and has a Function URL
                    return {
                        statusCode: 409,
                        headers: corsHeaders,
                        body: JSON.stringify({ 
                            message: 'Agent already exists with Function URL',
                            agent_id: userId,
                            existing_function_url: existingAgent.agent_trigger,
                            action: 'use_existing'
                        })
                    };
                } else {
                    console.log('Step 2.6: Agent exists but no Function URL, will create Function URL...');
                }
            } else {
                console.log('Step 2.6: Agent not found, will create new agent...');
            }
        } catch (checkError) {
            console.error('Step 2.5 ERROR: Failed to check existing agent:', checkError.message);
            // Continue with creation if check fails
        }
        
        // Fetch agent data from agents2 table
        let agentData;
        try {
            console.log('Step 3: Fetching agent data from database...');
            const url = `${supabaseUrl}/rest/v1/agents2?id=eq.${userId}&select=prompt,post_configuration,graphic,meme,video`;
            
            const response = await httpsRequest(url, {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('Step 4: Database response received, status:', response.status);
            
            if (response.status >= 200 && response.status < 300) {
                const agents = response.data;
                
                if (!agents || agents.length === 0) {
                    return {
                        statusCode: 404,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'OPTIONS,POST'
                        },
                        body: JSON.stringify({ message: 'Agent not found' })
                    };
                }
                
                agentData = agents[0];
                console.log('Step 5: Agent data retrieved successfully');
                
                // Parse post_configuration JSON
                let postConfig = {};
                try {
                    if (agentData.post_configuration) {
                        postConfig = JSON.parse(agentData.post_configuration);
                        console.log('Step 6: Post configuration parsed successfully');
                    }
                } catch (parseError) {
                    console.error('Error parsing post_configuration:', parseError);
                    return {
                        statusCode: 400,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'OPTIONS,POST'
                        },
                        body: JSON.stringify({ message: 'Invalid post_configuration JSON' })
                    };
                }
                
                // Validate required fields
                if (!postConfig.interval || !postConfig.topics || !agentData.prompt) {
                    return {
                        statusCode: 400,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'OPTIONS,POST'
                        },
                        body: JSON.stringify({ message: 'Agent configuration incomplete: missing interval, topics, or prompt' })
                    };
                }
                
                console.log('Step 7: Configuration validation completed');
                
                // Extract values for Lambda creation
                const interval = postConfig.interval;
                const query = postConfig.topics;
                const systemPrompt = agentData.prompt;
                const { graphic, meme, video } = agentData;
                
                console.log('Step 8: Starting Lambda function creation...');
                
                // Check Lambda execution role
                const roleArn = process.env.LAMBDA_EXECUTION_ROLE || process.env.AWS_LAMBDA_ROLE_ARN;
                if (!roleArn) {
                    return {
                        statusCode: 500,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'OPTIONS,POST'
                        },
                        body: JSON.stringify({ 
                            message: 'Lambda execution role not configured',
                            debug: { 
                                hasLambdaRole: !!process.env.LAMBDA_EXECUTION_ROLE,
                                hasAwsLambdaRole: !!process.env.AWS_LAMBDA_ROLE_ARN
                            }
                        })
                    };
                }
                
                console.log('Step 9: Role validation completed');
                
                // Create unique function name
                const functionName = `analysis-function-${userId}`;
                console.log('Step 10: Function name generated:', functionName);
                
                // Create the Lambda function code
                console.log('Step 11: Generating function code...');
                const functionCode = `
// Using native fetch instead of axios
exports.handler = async (event) => {
    console.log('Starting analysis function');
    
    // Get configuration from environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    const superMemeApiToken = process.env.SUPER_MEME_API_TOKEN;
    const agentId = '${userId}';
    
    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase configuration');
        return { success: false, error: 'Missing Supabase configuration' };
    }
    
    // Fetch agent configuration from Supabase
    async function fetchAgentConfig() {
        try {
            const response = await fetch(supabaseUrl + '/rest/v1/agents2?id=eq.' + agentId + '&select=prompt,post_configuration,graphic,meme,video', {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': 'Bearer ' + supabaseKey,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch agent config: ' + response.status);
            }
            
            const agents = await response.json();
            if (!agents || agents.length === 0) {
                throw new Error('Agent not found');
            }
            
            const agent = agents[0];
            let postConfig = {};
            
            try {
                if (agent.post_configuration) {
                    postConfig = JSON.parse(agent.post_configuration);
                }
            } catch (parseError) {
                console.error('Error parsing post_configuration:', parseError);
                throw new Error('Invalid post_configuration JSON');
            }
            
            return {
                systemPrompt: agent.prompt,
                topics: postConfig.topics,
                interval: postConfig.interval,
                graphic: agent.graphic,
                meme: agent.meme,
                video: agent.video
            };
        } catch (error) {
            console.error('Error fetching agent config:', error);
            throw error;
        }
    }
    
    // Supabase REST API implementation
    async function insertToSupabase(data, isMeme = false, memeUrl = null, isGraphic = false, graphicUrl = null) {
        try {
            const payload = {
                agent_id: agentId,
                tweet_content: data,
                posted: false,
                created_at: new Date().toISOString()
            };
            
            // Add meme URL if this is a meme post
            if (isMeme && memeUrl) {
                payload.meme_url = memeUrl;
                payload.is_meme = true;
            }
            
            // Add graphic URL if this is a graphic post
            if (isGraphic && graphicUrl) {
                payload.image_url = graphicUrl;
                payload.is_graphic = true;
            }
            
            const response = await fetch(supabaseUrl + '/rest/v1/terminal2', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': 'Bearer ' + supabaseKey
                },
                body: JSON.stringify([payload])
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
            try {
                return JSON.parse(responseText);
            } catch (parseError) {
                return { success: true };
            }
        } catch (error) {
            console.error('Error in insertToSupabase:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Function to store meme URLs in a separate table
    async function storeMemeUrls(urls, originalTweetContent) {
        try {
            const memeEntries = urls.map((url, index) => ({
                agent_id: agentId,
                meme_url: url,
                original_tweet: originalTweetContent,
                posted: false,
                post_order: index + 1,
                created_at: new Date().toISOString()
            }));
            
            const response = await fetch(supabaseUrl + '/rest/v1/meme_queue', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': 'Bearer ' + supabaseKey
                },
                body: JSON.stringify(memeEntries)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error('Failed to store meme URLs: ' + errorText);
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error storing meme URLs:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Function to get and post next pending meme
    async function postNextMeme() {
        try {
            // Get the next unposted meme
            const response = await fetch(supabaseUrl + '/rest/v1/meme_queue?agent_id=eq.' + agentId + '&posted=eq.false&order=post_order.asc&limit=1', {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': 'Bearer ' + supabaseKey
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch next meme');
            }
            
            const memes = await response.json();
            if (!memes || memes.length === 0) {
                console.log('No pending memes to post');
                return { success: true, noMemes: true };
            }
            
            const meme = memes[0];
            
            // Post the meme to terminal2
            const postResult = await insertToSupabase(meme.original_tweet, true, meme.meme_url);
            if (postResult.success !== false) {
                // Mark meme as posted
                await fetch(supabaseUrl + '/rest/v1/meme_queue?id=eq.' + meme.id, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': supabaseKey,
                        'Authorization': 'Bearer ' + supabaseKey
                    },
                    body: JSON.stringify({ posted: true, posted_at: new Date().toISOString() })
                });
                
                console.log('Posted meme successfully:', meme.meme_url);
                return { success: true, memePosted: true };
            }
            
            return postResult;
        } catch (error) {
            console.error('Error posting next meme:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Add function to get last 10 posts
    async function getLastTenPosts() {
        try {
            const response = await fetch(supabaseUrl + '/rest/v1/terminal2?agent_id=eq.' + agentId + '&select=tweet_content&order=created_at.desc&limit=10', {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': 'Bearer ' + supabaseKey
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
    
    // Add function to call Super Meme API
    async function callSuperMemeAPI(tweetContent) {
        try {
            if (!superMemeApiToken) {
                throw new Error('Super Meme API token not configured');
            }
            
            const response = await fetch('https://app.supermeme.ai/api/v2/meme/image', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + superMemeApiToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: tweetContent,
                    count: 6
                })
            });
            
            if (!response.ok) {
                throw new Error('Super Meme API request failed with status: ' + response.status);
            }
            
            const data = await response.json();
            console.log('Super Meme API response:', JSON.stringify(data));
            
            return data.memes || [];
        } catch (error) {
            console.error('Error calling Super Meme API:', error);
            throw error;
        }
    }
    
    // Add function to call Media API for text images
    async function callMediaAPI(backgroundColor, textColor, text) {
        try {
            const payload = {
                backgroundColor: backgroundColor,
                textColor: textColor,
                text: text
            };
            
            console.log('Calling Media API with payload:', JSON.stringify(payload));
            
            const response = await fetch('https://media-api-f4zh.onrender.com/api/generate-text-image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Media API request failed with status: ' + response.status);
            }
            
            const data = await response.json();
            console.log('Media API response:', JSON.stringify(data));
            
            return data.imageUrl || data.url || data.link;
        } catch (error) {
            console.error('Error calling Media API:', error);
            throw error;
        }
    }
    
    // Add function to call Video Generator API
    async function callVideoAPI(text, videoType) {
        try {
            const payload = {
                text: text,
                video_name: videoType
            };
            
            console.log('Calling Video API with payload:', JSON.stringify(payload));
            
            const response = await fetch('https://video-generator-ynrv.onrender.com/process_video', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Video API request failed with status: ' + response.status);
            }
            
            const data = await response.json();
            console.log('Video API response:', JSON.stringify(data));
            
            return data.video_url;
        } catch (error) {
            console.error('Error calling Video API:', error);
            throw error;
        }
    }
    
    // Function to clean JSON from markdown code blocks
    function cleanJsonFromMarkdown(text) {
        if (!text) return text;
        
        // Remove markdown code blocks - handle both escaped and actual newlines
        const cleanedText = text
            .replace(/\`\`\`json\\\\n/g, '')
            .replace(/\`\`\`json\\n/g, '')
            .replace(/\`\`\`json/g, '')
            .replace(/\`\`\`\\\\n/g, '')
            .replace(/\`\`\`\\n/g, '')
            .replace(/\`\`\`/g, '')
            .replace(/\\\\n/g, '\\n')  // Convert escaped newlines to actual newlines
            .trim();
        
        return cleanedText;
    }

    // Function to extract a JSON object from a string
    function extractJsonObject(str) {
        if (!str) return null;
        // Find the first '{' and the last '}'
        const startIndex = str.indexOf('{');
        const endIndex = str.lastIndexOf('}');

        if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
            return null; // No valid JSON object found
        }

        const jsonStr = str.substring(startIndex, endIndex + 1);

        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.log('Could not parse extracted substring as JSON.', e);
            return null;
        }
    }
    
    // Simplified function to extract description from API response
    function extractDescription(data) {
        if (!data) return 'No response data';
        
        // Try different common response formats
        const candidates = [
            data.result?.text, // Added this based on analyze API response format
            data.data?.analysis,
            data.result?.description,
            data.description,
            data.data,
            data.result,
            data.content,
            data.text,
            data.message
        ];
        
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate.trim();
            }
        }
        
        // If all else fails, stringify the response
        return typeof data === 'string' ? data : JSON.stringify(data);
    }
    
    try {
        // Fetch agent configuration dynamically
        console.log('Fetching agent configuration for agent ID:', agentId);
        const config = await fetchAgentConfig();
        
        const isGraphicMode = config.graphic === true;
        const isMemeAgentMode = config.meme === true;
        const isVideoMode = config.video === true;
        
        console.log('Agent configuration:', {
            graphic: isGraphicMode,
            meme: isMemeAgentMode,
            video: isVideoMode,
            topics: config.topics
        });
        
        if (isMemeAgentMode) {
            // For meme agents, first try to post any pending memes
            const memePostResult = await postNextMeme();
            if (memePostResult.success && memePostResult.memePosted) {
                console.log('Posted a pending meme, skipping new content generation');
                return { success: true, action: 'posted_pending_meme' };
            }
            
            // If no pending memes, generate new content and memes
            console.log('No pending memes, generating new content');
        }
        
        // Get last 10 posts before making the analysis call
        const lastPosts = await getLastTenPosts();
        
        let enhancedSystemPrompt;
        if (isVideoMode) {
            enhancedSystemPrompt = config.systemPrompt + '\\\\n If there is an error in data, dont mention the error in your post and instead just tweet about something relevant to your character prompt. Dont repeat the content of your last 10 posts. Your last 10 posts are:\\\\n' + lastPosts + '\\\\n\\\\nIMPORTANT: You generate brainrot explainer videos. You must return your response in JSON format with the following structure: {"text": "content for video", "video_type": "minecraft OR glass OR subway", "caption": "tweet text here"}. The video_type must be one of: minecraft, glass, or subway. The caption will be posted as tweet text along with the video URL. The "text" field should be a normal paragraph, not a list or thread. CRITICAL: Keep the "text" field under 200 characters for video generation to work properly.';
        } else if (isGraphicMode) {
            enhancedSystemPrompt = config.systemPrompt + '\\\\n If there is an error in data, dont mention the error in your post and instead just tweet about something relevant to your character prompt. Dont repeat the content of your last 10 posts. Your last 10 posts are:\\\\n' + lastPosts + '\\\\n\\\\nIMPORTANT: You must return your response in JSON format with the following structure: {"caption": "your tweet text here", "backgroundColor": "hex color or gradient", "textColor": "hex color", "text": "text to display on image"}. The caption will be posted as tweet text, and the other fields will be used to generate a graphic image.';
        } else {
            enhancedSystemPrompt = config.systemPrompt + '\\\\n If there is an error in data, dont mention the error in your post and instead just tweet about something relevant to your character prompt. Dont repeat the content of your last 10 posts. Your last 10 posts are:\\\\n' + lastPosts;
        }
        
        console.log('Calling analysis API with query:', 'Make a tweet about ' + config.topics);
        
        // Call the analysis API using fetch
        const response = await fetch('https://analyze-slaz.onrender.com/analyze', { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: config.topics,
                systemPrompt: enhancedSystemPrompt
            })
        });
        
        if (!response.ok) {
            throw new Error('API request failed with status: ' + response.status);
        }
        
        const data = await response.json();
        console.log('API response received:', JSON.stringify(data));
        
        // Process the response based on mode (video, graphic, or regular)
        let description, imageUrl, videoUrl;
        
        try {
            if (isVideoMode) {
                // For video mode, expect JSON response with text, video_type, and caption
                const videoData = extractDescription(data);
                
                // Clean JSON from markdown code blocks
                const cleanedVideoData = cleanJsonFromMarkdown(videoData);
                
                // Try to extract a JSON object from the potentially messy string
                const parsedVideoData = extractJsonObject(cleanedVideoData);
                
                if (parsedVideoData && parsedVideoData.text && parsedVideoData.video_type && parsedVideoData.caption) {
                    description = parsedVideoData.caption;
                    
                    // Extract video properties
                    const text = parsedVideoData.text;
                    const videoType = parsedVideoData.video_type;
                    
                    console.log('Extracted video data:', { text, videoType });
                    
                    // Call video API to generate video
                    try {
                        videoUrl = await callVideoAPI(text, videoType);
                        console.log('Generated video URL:', videoUrl);
                    } catch (videoError) {
                        console.error('Failed to generate video:', videoError);
                        // Continue without video if generation fails
                    }
                } else {
                    console.log('Failed to extract valid video JSON from response. Storing raw response for debugging.');
                    description = videoData;
                }
            } else if (isGraphicMode) {
                // For graphic mode, expect JSON response with caption, backgroundColor, textColor, text
                const graphicData = extractDescription(data);
                
                // Clean JSON from markdown code blocks
                const cleanedGraphicData = cleanJsonFromMarkdown(graphicData);
                
                // Try to extract a JSON object from the potentially messy string
                let parsedGraphicData = extractJsonObject(cleanedGraphicData);
                
                if (!parsedGraphicData) {
                    // Fallback: try direct JSON parse if extractJsonObject fails
                    try {
                        parsedGraphicData = JSON.parse(cleanedGraphicData);
                    } catch (parseError) {
                        console.log('Failed to parse as JSON, treating as regular text:', parseError);
                        description = graphicData;
                    }
                }
                
                if (parsedGraphicData && parsedGraphicData.caption) {
                    description = parsedGraphicData.caption;
                    
                    // Extract graphic properties
                    const backgroundColor = parsedGraphicData.backgroundColor || parsedGraphicData.backgroundGradient || '#ffffff';
                    const textColor = parsedGraphicData.textColor || '#000000';
                    const text = parsedGraphicData.text || description;
                    
                    console.log('Extracted graphic data:', { backgroundColor, textColor, text });
                    
                    // Call media API to generate image
                    try {
                        imageUrl = await callMediaAPI(backgroundColor, textColor, text);
                        console.log('Generated image URL:', imageUrl);
                    } catch (mediaError) {
                        console.error('Failed to generate image:', mediaError);
                        // Continue without image if generation fails
                    }
                } else {
                    // Fallback to regular text if parsing didn't yield expected format
                    description = graphicData;
                }
            } else {
                // Regular mode processing
                description = extractDescription(data);
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
            console.error('Error processing response:', error);
            description = 'Error processing analysis result';
        }
        
        // If this is a meme agent, call Super Meme API and store URLs
        if (isMemeAgentMode && description) {
            try {
                console.log('Calling Super Meme API for meme agent');
                const memeUrls = await callSuperMemeAPI(description);
                
                if (memeUrls && memeUrls.length > 0) {
                    console.log('Generated', memeUrls.length, 'memes');
                    
                    // Store meme URLs for posting at intervals
                    const storeResult = await storeMemeUrls(memeUrls, description);
                    if (storeResult.success) {
                        console.log('Stored meme URLs successfully');
                        
                        // Post the first meme immediately
                        const firstMemeResult = await postNextMeme();
                        
                        return { 
                            success: true, 
                            action: 'generated_memes',
                            memeCount: memeUrls.length,
                            firstMemePosted: firstMemeResult.success && firstMemeResult.memePosted
                        };
                    }
                }
            } catch (error) {
                console.error('Error with meme generation:', error);
                // Fall back to regular text post if meme generation fails
            }
        }
        
        // For non-meme agents or if meme generation failed, store the content
        if (isVideoMode && videoUrl) {
            // For video mode with video, store caption with video URL in tweet_content
            const videoContent = description + ' ' + videoUrl;
            const result = await insertToSupabase(videoContent);
            console.log('Video post with video URL stored successfully');
            return { success: true, action: 'video_post', videoUrl: videoUrl };
        } else if (isGraphicMode && imageUrl) {
            // For graphic mode with image, store caption with image URL
            const result = await insertToSupabase(description, false, null, true, imageUrl);
            console.log('Graphic post with image stored successfully');
            return { success: true, action: 'graphic_post', imageUrl: imageUrl };
        } else {
            // Regular text post
            const result = await insertToSupabase(description);
            console.log('Analysis completed and stored successfully');
            return { success: true, action: 'regular_post' };
        }
    } catch (error) {
        console.error('Error:', error);
        return { success: false, error: error.message };
    }
}`;

                console.log('Step 12: Creating Lambda function...');
                
                try {
                    // Create deployment package using our custom ZIP creator
                    console.log('Step 13: Creating deployment package...');
                    
                    const zipBuffer = createZipBuffer('index.js', functionCode);
                    
                    console.log('Step 13: ZIP package created, size:', zipBuffer.length, 'bytes');
                    
                    // Create the Lambda function
                    const createParams = {
                        Code: { ZipFile: zipBuffer },
                        FunctionName: functionName,
                        Handler: 'index.handler',
                        Role: roleArn,
                        Runtime: 'nodejs18.x',
                        Description: `Analysis function for user ${userId}`,
                        Timeout: 300,
                        Environment: {
                            Variables: {
                                SUPABASE_URL: supabaseUrl,
                                SUPABASE_KEY: supabaseKey,
                                SUPER_MEME_API_TOKEN: process.env.SUPER_MEME_API_TOKEN || ''
                            }
                        }
                    };
                    
                    console.log('Step 14: Calling Lambda createFunction...');
                    
                    let functionExists = false;
                    try {
                        await lambda.createFunction(createParams).promise();
                        console.log('Step 15: Lambda function created successfully!');
                    } catch (createError) {
                        if (createError.code === 'ResourceConflictException' && createError.message.includes('Function already exist')) {
                            console.log('Step 15: Lambda function already exists, continuing with Function URL creation...');
                            functionExists = true;
                        } else {
                            // Re-throw other errors
                            throw createError;
                        }
                    }
                    
                    // Create Function URL for HTTP(S) endpoint access
                    console.log('Step 16: Creating Function URL...');
                    let functionUrl = null;
                    let functionUrlError = null;
                    
                    try {
                        // Wait a moment for the function to be fully ready
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        // First, try to check if function URL already exists
                        try {
                            const existingUrlResponse = await lambda.getFunctionUrlConfig({ FunctionName: functionName }).promise();
                            if (existingUrlResponse && existingUrlResponse.FunctionUrl) {
                                functionUrl = existingUrlResponse.FunctionUrl;
                                console.log('Step 16.5: Function URL already exists:', functionUrl);
                                console.log('Step 16.5.1: Auth type:', existingUrlResponse.AuthType);
                                
                                // Update existing Function URL to AWS_IAM if it's currently NONE
                                if (existingUrlResponse.AuthType === 'NONE') {
                                    console.log('Step 16.5.2: Updating existing Function URL to AWS_IAM authentication...');
                                    try {
                                        const updateResponse = await lambda.updateFunctionUrlConfig({
                                            FunctionName: functionName,
                                            AuthType: 'AWS_IAM',
                                            Cors: {
                                                AllowOrigins: ['*'],
                                                AllowMethods: ['*'],
                                                AllowHeaders: ['*'],
                                                MaxAge: 86400
                                            }
                                        }).promise();
                                        console.log('Step 16.5.3: Function URL updated to AWS_IAM authentication');
                                        functionUrl = updateResponse.FunctionUrl;
                                    } catch (updateError) {
                                        console.error('Step ERROR: Failed to update Function URL auth type:', updateError.message);
                                    }
                                }
                            }
                        } catch (getUrlError) {
                            // Function URL doesn't exist, which is expected
                            console.log('Step 16.6: No existing function URL found, creating new one');
                        }
                        
                        // Only create if we don't already have one
                        if (!functionUrl) {
                            const functionUrlParams = {
                                FunctionName: functionName,
                                AuthType: 'AWS_IAM', // Use IAM authentication
                                Cors: {
                                    AllowOrigins: ['*'],
                                    AllowMethods: ['*'],
                                    AllowHeaders: ['*'],
                                    MaxAge: 86400
                                }
                            };
                            
                            console.log('Step 16.1: Function URL params:', JSON.stringify(functionUrlParams, null, 2));
                            
                            const functionUrlResponse = await lambda.createFunctionUrlConfig(functionUrlParams).promise();
                            
                            console.log('Step 16.2: Function URL response:', JSON.stringify(functionUrlResponse, null, 2));
                            
                            if (functionUrlResponse && functionUrlResponse.FunctionUrl) {
                                functionUrl = functionUrlResponse.FunctionUrl;
                                console.log('Step 17: Function URL created successfully with AWS_IAM authentication:', functionUrl);
                            } else {
                                console.error('Step ERROR: Function URL response does not contain FunctionUrl property');
                                functionUrlError = 'Function URL creation returned invalid response';
                            }
                        }
                        
                    } catch (urlError) {
                        console.error('Step ERROR: Function URL creation failed:', {
                            message: urlError.message,
                            code: urlError.code,
                            statusCode: urlError.statusCode,
                            stack: urlError.stack
                        });
                        functionUrlError = `${urlError.code || 'UnknownError'}: ${urlError.message}`;
                        
                        // Try alternative approach - add resource-based policy for function invocation
                        try {
                            console.log('Step 16.3: Attempting to add resource-based policy for public access...');
                            await lambda.addPermission({
                                FunctionName: functionName,
                                StatementId: 'FunctionURLAllowPublicAccess',
                                Action: 'lambda:InvokeFunctionUrl',
                                Principal: '*'
                            }).promise();
                            console.log('Step 16.4: Resource-based policy added successfully');
                        } catch (permissionError) {
                            console.error('Step ERROR: Could not add resource-based policy:', permissionError.message);
                        }
                    }
                    
                    // Additional debugging - log final values
                    console.log('Step 18: Final function URL status:', {
                        functionUrl: functionUrl,
                        functionUrlError: functionUrlError,
                        hasUrl: !!functionUrl,
                        hasError: !!functionUrlError
                    });
                    
                    // Update agent in database with function URL
                    if (functionUrl) {
                        try {
                            console.log('Step 19: Updating agent with function URL...');
                            const updateUrl = `${supabaseUrl}/rest/v1/agents2?id=eq.${userId}`;
                            
                            const updateResponse = await httpsRequest(updateUrl, {
                                method: 'PATCH',
                                headers: {
                                    'apikey': supabaseKey,
                                    'Authorization': `Bearer ${supabaseKey}`,
                                    'Content-Type': 'application/json',
                                    'Prefer': 'return=minimal'
                                },
                                body: JSON.stringify({
                                    agent_trigger: functionUrl,
                                    function_name: functionName,
                                    updated_at: new Date().toISOString()
                                })
                            });
                            
                            if (updateResponse.status >= 200 && updateResponse.status < 300) {
                                console.log('Step 20: Agent updated with function URL successfully');
                            } else {
                                console.error('Step ERROR: Failed to update agent with function URL:', updateResponse.status);
                            }
                        } catch (updateError) {
                            console.error('Step ERROR: Database update failed:', updateError.message);
                        }
                    }
                    
                    return {
                        statusCode: 200,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'OPTIONS,POST'
                        },
                        body: JSON.stringify({
                            message: functionExists ? 'Lambda function already exists - Function URL processed!' : 'Lambda function created successfully!',
                            functionName: functionName,
                            functionUrl: functionUrl,
                            functionUrlError: functionUrlError,
                            functionExists: functionExists,
                            userId: userId,
                            config: {
                                interval: interval,
                                topics: query,
                                graphic: graphic,
                                meme: meme,
                                video: video
                            },
                            timestamp: new Date().toISOString()
                        })
                    };
                    
                } catch (lambdaError) {
                    console.error('Step ERROR: Lambda creation failed:', lambdaError);
                    return {
                        statusCode: 500,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'OPTIONS,POST'
                        },
                        body: JSON.stringify({ 
                            message: 'Lambda creation failed',
                            error: lambdaError.message,
                            errorCode: lambdaError.code,
                            functionName: functionName
                        })
                    };
                }
            } else {
                console.error('Database request failed:', response.status, response.statusText);
                return {
                    statusCode: 500,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Methods': 'OPTIONS,POST'
                    },
                    body: JSON.stringify({ 
                        message: 'Database connection error',
                        debug: {
                            status: response.status,
                            statusText: response.statusText,
                            error: response.data
                        }
                    })
                };
            }
        } catch (requestError) {
            console.error('Database request failed:', requestError.message);
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST'
                },
                body: JSON.stringify({ 
                    message: 'Database connection error',
                    debug: {
                        error: requestError.message,
                        stack: requestError.stack
                    }
                })
            };
        }
        
        }
        
        // If no matching endpoint found
        return {
            statusCode: 404,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST'
            },
            body: JSON.stringify({ 
                error: 'Endpoint not found',
                path: path,
                method: httpMethod,
                available_endpoints: [
                    'POST /create - Create new Lambda function',
                    'POST /agent/{agentId} - Call existing agent'
                ]
            })
        };
        
    } catch (error) {
        console.error('Handler error:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST'
            },
            body: JSON.stringify({ 
                message: 'Internal server error',
                error: error.message,
                stack: error.stack
            })
        };
    }
};