// api/agent/[agentId].js - Vercel API route for calling agent via Supabase Edge Function
const https = require('https');

// Remove quotes if present
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/^['"]|['"]$/g, '');
const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || '').replace(/^['"]|['"]$/g, '');

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
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            data: res.statusCode >= 200 && res.statusCode < 300 ? JSON.parse(data) : data
          });
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
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Access-Control-Max-Age': '86400'
  };

  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const agentId = req.query.agentId;

  if (!agentId) {
    return res.status(400).json({ error: 'Missing agentId' });
  }

  try {
    // Get Edge Function URL for this agent
    // Try both string and numeric ID formats
    const functionUrl = `${supabaseUrl}/rest/v1/agents2?or=(id.eq.${agentId},id.eq.${parseInt(agentId) || agentId})&select=id,edge_function_url,agent_trigger`;
    
    const urlResponse = await httpsRequest(functionUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Agent query response:', JSON.stringify(urlResponse));
    console.log('Agent ID searched:', agentId);

    if (urlResponse.status < 200 || urlResponse.status >= 300 || !urlResponse.data || urlResponse.data.length === 0) {
      console.log('No agent found. Response:', urlResponse);
      return res.status(404).json({
        error: 'Agent not found',
        agent_id: agentId,
        debug: {
          status: urlResponse.status,
          data: urlResponse.data
        }
      });
    }

    const agent = urlResponse.data[0];
    console.log('Found agent:', JSON.stringify(agent));
    const edgeFunctionUrl = (agent.edge_function_url || agent.agent_trigger || '').trim();

    if (!edgeFunctionUrl) {
      console.log('Agent found but no edge_function_url. Agent data:', JSON.stringify(agent));
      return res.status(404).json({
        error: 'No Edge Function URL configured for this agent',
        agent_id: agentId,
        debug: {
          agent_found: true,
          edge_function_url: agent.edge_function_url,
          agent_trigger: agent.agent_trigger
        }
      });
    }

    // Call Supabase Edge Function
    const enrichedPayload = {
      ...req.body,
      agent_id: agentId,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'vercel-proxy',
        agent_id: agentId
      }
    };

    const result = await httpsRequest(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(enrichedPayload)
    });

    if (result.status === 200) {
      return res.status(200).json({
        success: true,
        agent_id: agentId,
        data: result.data,
        metadata: {
          response_time: new Date().toISOString(),
          edge_function_url: edgeFunctionUrl
        }
      });
    } else {
      return res.status(result.status).json({
        success: false,
        agent_id: agentId,
        error: result.data,
        status_code: result.status
      });
    }

  } catch (error) {
    console.error(`Error calling agent ${agentId}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      agent_id: agentId
    });
  }
}

