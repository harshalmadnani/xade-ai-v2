// api/create.js - Vercel API route for creating/updating agent configuration
const https = require('https');

// Get Supabase credentials from environment variables
// Remove quotes and newlines if present
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/^['"]|['"]$/g, '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || '').replace(/^['"]|['"]$/g, '').trim();
const supabaseEdgeFunctionUrl = (process.env.SUPABASE_EDGE_FUNCTION_URL || 
  `${supabaseUrl}/functions/v1/execute-agent`).trim();

// Helper function to sanitize header values
function sanitizeHeaders(headers) {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    // Remove any invalid characters from header values
    const cleanValue = String(value).replace(/[\r\n]/g, '').trim();
    sanitized[key] = cleanValue;
  }
  return sanitized;
}

// Helper function to make HTTPS requests
function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const sanitizedHeaders = sanitizeHeaders(options.headers);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: sanitizedHeaders
    }, (res) => {
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
          resolve({ status: res.statusCode, statusText: res.statusMessage, data });
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

module.exports = async function handler(req, res) {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Max-Age': '86400'
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'Missing required parameter: userId' });
    }

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ message: 'Missing Supabase configuration' });
    }

    console.log('Step 1: Request parsed successfully, userId:', userId);

    // Check if agent already exists
    console.log('Step 2: Checking if agent already exists...');
    const checkUrl = `${supabaseUrl}/rest/v1/agents2?id=eq.${userId}&select=id,agent_trigger,edge_function_url`;
    
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
      const existingUrl = (existingAgent.edge_function_url || existingAgent.agent_trigger || '').trim();
      if (existingUrl) {
        console.log('Agent already has Edge Function URL:', existingUrl);
        return res.status(200).json({
          message: 'Agent already configured',
          agent_id: userId,
          edge_function_url: existingUrl,
          action: 'already_configured',
          timestamp: new Date().toISOString()
        });
      }
      // Agent exists but no URL - proceed with update
      console.log('Agent exists but no Edge Function URL - will update');
    }

    // Fetch agent data from agents2 table
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

    if (response.status < 200 || response.status >= 300) {
      return res.status(500).json({
        message: 'Database connection error',
        debug: { status: response.status, statusText: response.statusText }
      });
    }

    const agents = response.data;
    if (!agents || agents.length === 0) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    const agentData = agents[0];
    console.log('Step 4: Agent data retrieved successfully');

    // Parse post_configuration JSON
    let postConfig = {};
    try {
      if (agentData.post_configuration) {
        postConfig = JSON.parse(agentData.post_configuration);
        console.log('Step 5: Post configuration parsed successfully');
      }
    } catch (parseError) {
      return res.status(400).json({ message: 'Invalid post_configuration JSON' });
    }

    // Validate required fields
    if (!postConfig.interval || !postConfig.topics || !agentData.prompt) {
      return res.status(400).json({
        message: 'Agent configuration incomplete: missing interval, topics, or prompt'
      });
    }

    console.log('Step 6: Configuration validation completed');

    const interval = postConfig.interval;
    const query = postConfig.topics;
    const systemPrompt = agentData.prompt;
    const { graphic, meme, video } = agentData;

    // Update agent in database with Edge Function URL
    console.log('Step 7: Updating agent with Edge Function URL...');
    const updateUrl = `${supabaseUrl}/rest/v1/agents2?id=eq.${userId}`;
    
    const updateResponse = await httpsRequest(updateUrl, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        edge_function_url: supabaseEdgeFunctionUrl.trim(),
        agent_trigger: supabaseEdgeFunctionUrl.trim(), // Keep for backward compatibility
        function_name: `agent-${userId}`, // Keep for reference
        eventbridge_interval: interval || null,
        eventbridge_status: interval && interval > 0 ? 'active' : null,
        last_run: null, // Initialize last_run
        is_active: true, // Mark as active
        updated_at: new Date().toISOString()
      })
    });

    // Check if update was successful
    let verifiedUrl = null;
    if (updateResponse.status >= 200 && updateResponse.status < 300) {
      console.log('Step 8: Agent updated successfully');
      console.log('Update response status:', updateResponse.status);
      
      // With return=representation, the response should contain the updated record
      if (updateResponse.data && Array.isArray(updateResponse.data) && updateResponse.data.length > 0) {
        const updatedAgent = updateResponse.data[0];
        verifiedUrl = (updatedAgent.edge_function_url || updatedAgent.agent_trigger || '').trim();
        console.log('Update response data:', JSON.stringify(updatedAgent));
        console.log('Extracted URL from update response:', verifiedUrl);
      } else {
        // Fallback: query back to verify
        console.log('Update response empty, querying back to verify...');
        const verifyUrl = `${supabaseUrl}/rest/v1/agents2?id=eq.${userId}&select=id,edge_function_url,agent_trigger`;
        const verifyResponse = await httpsRequest(verifyUrl, {
          method: 'GET',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          }
        });
        console.log('Verification query result:', JSON.stringify(verifyResponse.data));
        if (verifyResponse.data && verifyResponse.data.length > 0) {
          verifiedUrl = (verifyResponse.data[0].edge_function_url || verifyResponse.data[0].agent_trigger || '').trim();
        }
      }
    } else {
      console.error('Step ERROR: Failed to update agent:', updateResponse.status);
      console.error('Update error:', JSON.stringify(updateResponse.data));
    }

    return res.status(200).json({
      message: 'Agent configured successfully!',
      agent_id: userId,
      edge_function_url: verifiedUrl || supabaseEdgeFunctionUrl,
      userId: userId,
      config: {
        interval: interval,
        topics: query,
        graphic: graphic,
        meme: meme,
        video: video
      },
      note: 'Agent will be executed by cron job based on interval',
      verification: {
        update_status: updateResponse.status,
        verified_url: verifiedUrl,
        database_has_url: !!verifiedUrl
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message
    });
  }
}

