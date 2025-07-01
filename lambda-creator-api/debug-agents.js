const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase configuration');
    console.error('SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
    console.error('SUPABASE_SERVICE_KEY:', supabaseKey ? 'Set' : 'Missing');
    process.exit(1);
}

console.log('🔗 Supabase URL:', supabaseUrl);
console.log('🔑 Supabase Key:', supabaseKey ? 'Set (length: ' + supabaseKey.length + ')' : 'Missing');

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugAgents() {
    console.log('🔍 Debugging agents2 table...\n');
    
    try {
        // First, let's see all agents with user_id = "1"
        console.log('1. Fetching agents with user_id = "1"...');
        const { data: agents1, error: error1 } = await supabase
            .from('agents2')
            .select('id, user_id, prompt, post_configuration, graphic, meme')
            .eq('user_id', '1');
        
        if (error1) {
            console.error('❌ Error fetching agents with user_id="1":', error1);
        } else {
            console.log('✅ Found', agents1?.length || 0, 'agents with user_id="1"');
            if (agents1 && agents1.length > 0) {
                agents1.forEach(agent => {
                    console.log(`  - Agent ID: ${agent.id}, graphic: ${agent.graphic}, meme: ${agent.meme}`);
                    console.log(`    Prompt: ${agent.prompt?.substring(0, 50)}...`);
                    console.log(`    Post config: ${agent.post_configuration ? 'Present' : 'Missing'}`);
                });
            }
        }
        
        console.log('\n2. Fetching agents with id = 1...');
        const { data: agents2, error: error2 } = await supabase
            .from('agents2')
            .select('id, user_id, prompt, post_configuration, graphic, meme')
            .eq('id', 1);
        
        if (error2) {
            console.error('❌ Error fetching agents with id=1:', error2);
        } else {
            console.log('✅ Found', agents2?.length || 0, 'agents with id=1');
            if (agents2 && agents2.length > 0) {
                agents2.forEach(agent => {
                    console.log(`  - Agent ID: ${agent.id}, user_id: "${agent.user_id}", graphic: ${agent.graphic}, meme: ${agent.meme}`);
                    console.log(`    Prompt: ${agent.prompt?.substring(0, 50)}...`);
                    console.log(`    Post config: ${agent.post_configuration ? 'Present' : 'Missing'}`);
                });
            }
        }
        
        console.log('\n3. Fetching all agents (first 10)...');
        const { data: allAgents, error: error3 } = await supabase
            .from('agents2')
            .select('id, user_id, prompt, post_configuration, graphic, meme')
            .limit(10);
        
        if (error3) {
            console.error('❌ Error fetching all agents:', error3);
        } else {
            console.log('✅ Found', allAgents?.length || 0, 'total agents (showing first 10)');
            if (allAgents && allAgents.length > 0) {
                allAgents.forEach(agent => {
                    console.log(`  - Agent ID: ${agent.id}, user_id: "${agent.user_id}", graphic: ${agent.graphic}, meme: ${agent.meme}`);
                });
            }
        }
        
        console.log('\n4. Testing the exact same query as the Lambda function...');
        const { data: lambdaTest, error: lambdaError } = await supabase
            .from('agents2')
            .select('prompt, post_configuration, graphic, meme')
            .eq('user_id', '1')
            .limit(1)
            .single();
        
        if (lambdaError) {
            console.error('❌ Lambda query error:', lambdaError);
        } else {
            console.log('✅ Lambda query successful');
            console.log('Agent data:', lambdaTest);
            
            // Try to parse post_configuration
            try {
                const postConfig = JSON.parse(lambdaTest.post_configuration);
                console.log('Post configuration parsed successfully:');
                console.log('- Interval:', postConfig.interval);
                console.log('- Topics:', postConfig.topics?.substring(0, 100) + '...');
            } catch (parseError) {
                console.error('❌ Failed to parse post_configuration:', parseError);
            }
        }
        
    } catch (error) {
        console.error('💥 Unexpected error:', error);
    }
}

debugAgents().catch(error => {
    console.error('💥 Script error:', error);
    process.exit(1);
}); 