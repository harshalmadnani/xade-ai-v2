// test-vercel-routes.js - Test script for Vercel API routes
const https = require('https');
require('dotenv').config();

const BASE_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : 'http://localhost:3000';

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data
          });
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

async function testCreateEndpoint() {
  console.log('\n🧪 Testing /api/create endpoint...');
  
  if (!process.env.TEST_USER_ID) {
    console.log('⚠️  Skipping - TEST_USER_ID not set');
    return;
  }

  try {
    const result = await makeRequest(`${BASE_URL}/api/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: process.env.TEST_USER_ID
      })
    });

    console.log('Status:', result.status);
    console.log('Response:', JSON.stringify(result.data, null, 2));
    
    if (result.status === 200 || result.status === 409) {
      console.log('✅ Create endpoint test passed');
    } else {
      console.log('❌ Create endpoint test failed');
    }
  } catch (error) {
    console.error('❌ Error testing create endpoint:', error.message);
  }
}

async function testAgentEndpoint() {
  console.log('\n🧪 Testing /api/agent/[agentId] endpoint...');
  
  if (!process.env.TEST_USER_ID) {
    console.log('⚠️  Skipping - TEST_USER_ID not set');
    return;
  }

  try {
    const result = await makeRequest(`${BASE_URL}/api/agent/${process.env.TEST_USER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    console.log('Status:', result.status);
    console.log('Response:', JSON.stringify(result.data, null, 2));
    
    if (result.status === 200) {
      console.log('✅ Agent endpoint test passed');
    } else {
      console.log('⚠️  Agent endpoint returned non-200 status (may be expected)');
    }
  } catch (error) {
    console.error('❌ Error testing agent endpoint:', error.message);
  }
}

async function testCronEndpoint() {
  console.log('\n🧪 Testing /api/cron endpoint...');
  
  try {
    const headers = {};
    if (process.env.CRON_SECRET) {
      headers['Authorization'] = `Bearer ${process.env.CRON_SECRET}`;
    }

    const result = await makeRequest(`${BASE_URL}/api/cron`, {
      method: 'GET',
      headers: headers
    });

    console.log('Status:', result.status);
    console.log('Response:', JSON.stringify(result.data, null, 2));
    
    if (result.status === 200) {
      console.log('✅ Cron endpoint test passed');
    } else if (result.status === 401) {
      console.log('⚠️  Cron endpoint requires CRON_SECRET (set in environment)');
    } else {
      console.log('❌ Cron endpoint test failed');
    }
  } catch (error) {
    console.error('❌ Error testing cron endpoint:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Starting Vercel API Routes Tests');
  console.log('Base URL:', BASE_URL);
  console.log('Environment variables:');
  console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Missing');
  console.log('  SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'Set' : 'Missing');
  console.log('  TEST_USER_ID:', process.env.TEST_USER_ID || 'Not set');
  console.log('  CRON_SECRET:', process.env.CRON_SECRET ? 'Set' : 'Not set');

  await testCreateEndpoint();
  await testAgentEndpoint();
  await testCronEndpoint();

  console.log('\n✨ Tests completed!');
}

runTests().catch(console.error);


