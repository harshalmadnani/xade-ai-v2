const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Test configuration - using numeric ID to match terminal2 table schema
const TEST_USER_ID = 999999999; // Using actual numeric ID to match bigint fields
const TEST_QUERY = 'Make a funny meme about cryptocurrency being volatile';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const superMemeToken = process.env.SUPER_MEME_API_TOKEN || 'q2hdfDvhsm+QWr2mtjEgAb5xfe8=';

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase configuration in environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSuperMemeAPI(tweetContent) {
    console.log('🎭 Testing Super Meme API...');
    
    try {
        const response = await fetch('https://app.supermeme.ai/api/v2/meme/image', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${superMemeToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: tweetContent,
                count: 6
            })
        });
        
        if (!response.ok) {
            throw new Error(`Super Meme API request failed with status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ Super Meme API responded successfully');
        console.log(`📊 Generated ${data.memes?.length || 0} memes`);
        
        if (data.memes && data.memes.length > 0) {
            console.log('🔗 First meme URL:', data.memes[0]);
        }
        
        return data.memes || [];
    } catch (error) {
        console.error('❌ Super Meme API test failed:', error.message);
        return [];
    }
}

async function testDatabaseOperations() {
    console.log('🗄️  Testing database operations...');
    
    try {
        // Test meme_queue table
        const { data: queueData, error: queueError } = await supabase
            .from('meme_queue')
            .select('*')
            .limit(1);
        
        if (queueError) {
            console.error('❌ meme_queue table error:', queueError.message);
            return false;
        }
        
        console.log('✅ meme_queue table accessible');
        
        // Test terminal2 table enhancements
        const { data: terminalData, error: terminalError } = await supabase
            .from('terminal2')
            .select('meme_url, is_meme')
            .limit(1);
        
        if (terminalError) {
            console.error('❌ terminal2 meme columns error:', terminalError.message);
            return false;
        }
        
        console.log('✅ terminal2 meme columns accessible');
        
        // Test agents2 table meme column
        const { data: agentsData, error: agentsError } = await supabase
            .from('agents2')
            .select('meme')
            .limit(1);
        
        if (agentsError) {
            console.error('❌ agents2 meme column error:', agentsError.message);
            return false;
        }
        
        console.log('✅ agents2 meme column accessible');
        
        return true;
    } catch (error) {
        console.error('❌ Database operations test failed:', error.message);
        return false;
    }
}

async function testMemeAgentFlow() {
    console.log('🤖 Testing full meme agent flow...');
    
    try {
        // 1. Set up test agent as meme agent
        console.log('📝 Setting up test meme agent...');
        const { error: agentError } = await supabase
            .from('agents2')
            .upsert({
                user_id: TEST_USER_ID, // Should work with numeric string
                meme: true,
                created_at: new Date().toISOString()
            });
        
        if (agentError) {
            console.error('❌ Failed to set up test agent:', agentError.message);
            return false;
        }
        
        console.log('✅ Test meme agent configured');
        
        // 2. Test meme generation
        const memeUrls = await testSuperMemeAPI(TEST_QUERY);
        
        if (memeUrls.length === 0) {
            console.error('❌ No memes generated, stopping test');
            return false;
        }
        
        // 3. Test storing memes in queue
        console.log('💾 Testing meme storage...');
        const memeEntries = memeUrls.map((url, index) => ({
            agent_id: TEST_USER_ID,
            meme_url: url,
            original_tweet: TEST_QUERY,
            posted: false,
            post_order: index + 1,
            created_at: new Date().toISOString()
        }));
        
        const { error: storeError } = await supabase
            .from('meme_queue')
            .insert(memeEntries);
        
        if (storeError) {
            console.error('❌ Failed to store memes:', storeError.message);
            return false;
        }
        
        console.log('✅ Memes stored in queue successfully');
        
        // 4. Test posting a meme
        console.log('📤 Testing meme posting...');
        const { data: nextMeme, error: fetchError } = await supabase
            .from('meme_queue')
            .select('*')
            .eq('agent_id', TEST_USER_ID)
            .eq('posted', false)
            .order('post_order')
            .limit(1);
        
        if (fetchError || !nextMeme || nextMeme.length === 0) {
            console.error('❌ Failed to fetch next meme:', fetchError?.message || 'No memes found');
            return false;
        }
        
        const meme = nextMeme[0];
        
        // Post the meme to terminal2
        const { error: postError } = await supabase
            .from('terminal2')
            .insert({
                agent_id: TEST_USER_ID,
                tweet_content: meme.original_tweet,
                meme_url: meme.meme_url,
                is_meme: true,
                posted: false,
                created_at: new Date().toISOString()
            });
        
        if (postError) {
            console.error('❌ Failed to post meme:', postError.message);
            return false;
        }
        
        // Mark meme as posted
        const { error: updateError } = await supabase
            .from('meme_queue')
            .update({ 
                posted: true, 
                posted_at: new Date().toISOString() 
            })
            .eq('id', meme.id);
        
        if (updateError) {
            console.error('❌ Failed to mark meme as posted:', updateError.message);
            return false;
        }
        
        console.log('✅ Meme posted successfully');
        console.log('🔗 Posted meme URL:', meme.meme_url);
        
        return true;
    } catch (error) {
        console.error('❌ Meme agent flow test failed:', error.message);
        return false;
    }
}

async function cleanupTestData() {
    console.log('🧹 Cleaning up test data...');
    
    try {
        // Remove test memes from queue
        await supabase
            .from('meme_queue')
            .delete()
            .eq('agent_id', TEST_USER_ID);
        
        // Remove test posts from terminal2
        await supabase
            .from('terminal2')
            .delete()
            .eq('agent_id', TEST_USER_ID);
        
        // Remove test agent
        await supabase
            .from('agents2')
            .delete()
            .eq('user_id', TEST_USER_ID);
        
        console.log('✅ Test data cleaned up');
    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
    }
}

async function runTests() {
    console.log('🚀 Starting Meme Agent Tests\n');
    
    const dbTest = await testDatabaseOperations();
    console.log('');
    
    if (!dbTest) {
        console.error('❌ Database tests failed. Please run the SQL setup script first.');
        return;
    }
    
    const flowTest = await testMemeAgentFlow();
    console.log('');
    
    await cleanupTestData();
    console.log('');
    
    if (flowTest) {
        console.log('🎉 All tests passed! Meme agent functionality is working correctly.');
        console.log('📋 Next steps:');
        console.log('   1. Set SUPER_MEME_API_TOKEN environment variable in your Lambda');
        console.log('   2. Deploy the updated Lambda function');
        console.log('   3. Set meme = true for your agents in the agents2 table');
    } else {
        console.log('❌ Some tests failed. Please check the errors above and fix them before deployment.');
    }
}

// Run tests
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = {
    testSuperMemeAPI,
    testDatabaseOperations,
    testMemeAgentFlow,
    cleanupTestData
}; 