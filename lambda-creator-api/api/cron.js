// api/cron.js - Vercel Cron job that checks for due agents and executes them
const https = require('https');

// Remove quotes if present
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/^['"]|['"]$/g, '');
const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || '').replace(/^['"]|['"]$/g, '');
const vercelUrl = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL;
const cronSecret = process.env.CRON_SECRET;

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
  // Verify this is called from Vercel Cron (optional security check)
  // Note: Vercel Cron sends Authorization header automatically, but we can add extra security
  const authHeader = req.headers['authorization'];
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Allow if no secret is set (for testing) or if header matches
    if (cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    console.log('Cron job started:', new Date().toISOString());

    // Get all active agents with intervals
    const agentsUrl = `${supabaseUrl}/rest/v1/agents2?is_active=eq.true&select=id,eventbridge_interval,last_run`;
    
    const agentsResponse = await httpsRequest(agentsUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (agentsResponse.status < 200 || agentsResponse.status >= 300) {
      throw new Error('Failed to fetch agents');
    }

    const agents = agentsResponse.data || [];
    console.log(`Found ${agents.length} active agents`);

    const now = new Date();
    const dueAgents = [];

    // Check which agents are due for execution
    for (const agent of agents) {
      if (!agent.eventbridge_interval || agent.eventbridge_interval <= 0) {
        continue; // Skip agents without intervals
      }

      const intervalMinutes = agent.eventbridge_interval;
      const lastRun = agent.last_run ? new Date(agent.last_run) : null;

      if (!lastRun) {
        // Never run before, execute now
        dueAgents.push(agent.id);
        continue;
      }

      const minutesSinceLastRun = (now - lastRun) / (1000 * 60);
      
      if (minutesSinceLastRun >= intervalMinutes) {
        dueAgents.push(agent.id);
      }
    }

    console.log(`Found ${dueAgents.length} agents due for execution`);

    // Execute each due agent
    const results = [];
    // Determine base URL - use Vercel URL if available, otherwise try to construct
    let baseUrl;
    if (vercelUrl) {
      baseUrl = vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
    } else if (process.env.VERCEL_URL) {
      baseUrl = `https://${process.env.VERCEL_URL}`;
    } else {
      // Fallback for local development
      baseUrl = 'http://localhost:3000';
    }

    for (const agentId of dueAgents) {
      try {
        // Call the agent endpoint
        const agentUrl = `${baseUrl}/api/agent/${agentId}`;
        const result = await httpsRequest(agentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        });

        // Update last_run timestamp
        const updateUrl = `${supabaseUrl}/rest/v1/agents2?id=eq.${agentId}`;
        await httpsRequest(updateUrl, {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            last_run: now.toISOString()
          })
        });

        results.push({
          agent_id: agentId,
          status: result.status,
          success: result.status === 200
        });

        console.log(`✅ Executed agent ${agentId}`);

      } catch (error) {
        console.error(`❌ Error executing agent ${agentId}:`, error.message);
        results.push({
          agent_id: agentId,
          status: 'error',
          success: false,
          error: error.message
        });
      }
    }

    return res.status(200).json({
      success: true,
      timestamp: now.toISOString(),
      total_agents: agents.length,
      due_agents: dueAgents.length,
      executed: results.length,
      results: results
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

