const AWS = require('aws-sdk');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Initialize AWS services
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

exports.handler = async (event) => {
    console.log('Starting Lambda creator API');
    
    try {
        // Parse request body
        const body = JSON.parse(event.body || '{}');
        const { userId } = body;
        
        if (!userId) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST'
                },
                body: JSON.stringify({ message: 'Missing required parameter: userId' })
            };
        }
        
        console.log('Step 1: Request parsed successfully, userId:', userId);
        
        // Check environment variables
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
        
        console.log('Step 2: Environment variables validated');
        
        // Fetch agent data from agents2 table
        let agentData;
        try {
            console.log('Step 3: Fetching agent data from database...');
            const url = `${supabaseUrl}/rest/v1/agents2?id=eq.${userId}&select=prompt,post_configuration,graphic,meme`;
            
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
                const { graphic, meme } = agentData;
                
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
                const functionName = `analysis-function-${userId}-${Date.now()}`;
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
            const response = await fetch(supabaseUrl + '/rest/v1/agents2?id=eq.' + agentId + '&select=prompt,post_configuration,graphic,meme', {
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
                meme: agent.meme
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
    
    // Simplified function to extract description from API response
    function extractDescription(data) {
        if (!data) return 'No response data';
        
        // Try different common response formats
        const candidates = [
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
        
        console.log('Agent configuration:', {
            graphic: isGraphicMode,
            meme: isMemeAgentMode,
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
        if (isGraphicMode) {
            enhancedSystemPrompt = config.systemPrompt + '\\n If there is an error in data, dont mention the error in your post and instead just tweet about something relevant to your character prompt. Dont repeat the content of your last 10 posts. Your last 10 posts are:\\n' + lastPosts + '\\n\\nIMPORTANT: You must return your response in JSON format with the following structure: {"caption": "your tweet text here", "backgroundColor": "hex color or gradient", "textColor": "hex color", "text": "text to display on image"}. The caption will be posted as tweet text, and the other fields will be used to generate a graphic image.';
        } else {
            enhancedSystemPrompt = config.systemPrompt + '\\n If there is an error in data, dont mention the error in your post and instead just tweet about something relevant to your character prompt. Dont repeat the content of your last 10 posts. Your last 10 posts are:\\n' + lastPosts;
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
        
        // Process the response based on mode (graphic or regular)
        let description, imageUrl;
        
        try {
            if (isGraphicMode) {
                // For graphic mode, expect JSON response with caption, backgroundColor, textColor, text
                const graphicData = extractDescription(data);
                
                // Try to parse as JSON for graphic mode
                let parsedGraphicData;
                try {
                    parsedGraphicData = JSON.parse(graphicData);
                } catch (parseError) {
                    console.log('Failed to parse as JSON, treating as regular text:', parseError);
                    description = graphicData;
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
        if (isGraphicMode && imageUrl) {
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
                        Timeout: 60,
                        Environment: {
                            Variables: {
                                SUPABASE_URL: supabaseUrl,
                                SUPABASE_KEY: supabaseKey,
                                SUPER_MEME_API_TOKEN: process.env.SUPER_MEME_API_TOKEN || ''
                            }
                        }
                    };
                    
                    console.log('Step 14: Calling Lambda createFunction...');
                    await lambda.createFunction(createParams).promise();
                    console.log('Step 15: Lambda function created successfully!');
                    
                    return {
                        statusCode: 200,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': 'Content-Type',
                            'Access-Control-Allow-Methods': 'OPTIONS,POST'
                        },
                        body: JSON.stringify({
                            message: 'Lambda function created successfully!',
                            functionName: functionName,
                            userId: userId,
                            config: {
                                interval: interval,
                                topics: query,
                                graphic: graphic,
                                meme: meme
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