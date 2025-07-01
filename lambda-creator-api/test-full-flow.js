const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
require('dotenv').config();

// Test configuration
const TEST_USER_ID = 1;
const API_ENDPOINT = 'https://ieyyhrqs1h.execute-api.ap-south-1.amazonaws.com/prod/create';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase configuration in environment variables');
    console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupTestAgent() {
    console.log('📝 Setting up test agent in agents2 table...');
    
    try {
        // Create or update agent record with all required fields
        const { data, error } = await supabase
            .from('agents2')
            .upsert({
                id: TEST_USER_ID,
                interval: 2, // 2 minutes for testing
                query: 'What is the latest news about Bitcoin and cryptocurrency?',
                system_prompt: 'You are a helpful AI assistant that creates engaging social media content about cryptocurrency and blockchain technology. Keep your responses concise and informative.',
                graphic: false, // Set to true to test graphic mode
                meme: false,   // Set to true to test meme mode
                created_at: new Date().toISOString()
            })
            .select();
        
        if (error) {
            console.error('❌ Failed to setup test agent:', error.message);
            return false;
        }
        
        console.log('✅ Test agent created/updated successfully:', data);
        return true;
    } catch (error) {
        console.error('❌ Error setting up test agent:', error.message);
        return false;
    }
}

async function testLambdaCreatorAPI() {
    console.log('🚀 Testing Lambda Creator API...');
    
    try {
        const payload = {
            userId: TEST_USER_ID.toString()
        };
        
        console.log('📤 Sending request:', JSON.stringify(payload));
        console.log('🔗 API Endpoint:', API_ENDPOINT);
        
        const response = await axios.post(API_ENDPOINT, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 60000 // 60 second timeout
        });
        
        console.log('✅ API call successful!');
        console.log('📋 Response:', JSON.stringify(response.data, null, 2));
        
        return true;
    } catch (error) {
        console.error('❌ API call failed:');
        
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', error.response.data);
        } else if (error.request) {
            console.error('Request error:', error.message);
        } else {
            console.error('Error:', error.message);
        }
        
        return false;
    }
}

async function verifyAgentConfiguration() {
    console.log('🔍 Verifying agent configuration...');
    
    try {
        const { data, error } = await supabase
            .from('agents2')
            .select('*')
            .eq('id', TEST_USER_ID)
            .single();
        
        if (error) {
            console.error('❌ Failed to fetch agent:', error.message);
            return false;
        }
        
        console.log('✅ Agent configuration:');
        console.log('- ID:', data.id);
        console.log('- Interval:', data.interval, 'minutes');
        console.log('- Query:', data.query);
        console.log('- System Prompt:', data.system_prompt?.substring(0, 100) + '...');
        console.log('- Graphic Mode:', data.graphic);
        console.log('- Meme Mode:', data.meme);
        
        // Validate required fields
        const requiredFields = ['interval', 'query', 'system_prompt'];
        const missingFields = requiredFields.filter(field => !data[field]);
        
        if (missingFields.length > 0) {
            console.error('❌ Missing required fields:', missingFields);
            return false;
        }
        
        console.log('✅ All required fields present');
        return true;
    } catch (error) {
        console.error('❌ Error verifying agent configuration:', error.message);
        return false;
    }
}

async function runFullTest() {
    console.log('🧪 Starting full flow test...\n');
    
    // Step 1: Setup test agent
    const setupSuccess = await setupTestAgent();
    if (!setupSuccess) {
        console.error('\n❌ Test failed at setup stage');
        return;
    }
    
    console.log(''); // Add spacing
    
    // Step 2: Verify configuration
    const verifySuccess = await verifyAgentConfiguration();
    if (!verifySuccess) {
        console.error('\n❌ Test failed at verification stage');
        return;
    }
    
    console.log(''); // Add spacing
    
    // Step 3: Test API call
    const apiSuccess = await testLambdaCreatorAPI();
    if (!apiSuccess) {
        console.error('\n❌ Test failed at API call stage');
        return;
    }
    
    console.log('\n🎉 Full flow test completed successfully!');
    console.log('📝 Summary:');
    console.log('- ✅ Agent record created/updated in agents2 table');
    console.log('- ✅ Configuration verified');
    console.log('- ✅ Lambda Creator API called successfully');
    console.log('- ✅ Lambda function should be created and scheduled');
}

// Run the test
runFullTest().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
}); 