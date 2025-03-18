// lambda-creator-api/test-edit.js
const axios = require('axios');

// Helper function to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testLambdaEditor() {
  try {
    // Replace with your actual function name and API URL
    const functionName = "analysis-function-1742323915366-1742323915592"; // Updated with your actual function name
    const userId = "1742323915366"; // Updated to match the first part of the function name
    
    const payload = {
      functionName: functionName,
      userId: userId,
      interval: 30, // Change interval to 30 minutes
      query: "What's happening with AI today?", // Update the query
      systemPrompt: "You are a tech enthusiast who loves to share insights about AI advancements." // Update system prompt
    };
    
    console.log('Sending payload:', JSON.stringify(payload));
    
    const response = await axios.put(
      'https://97m15gg62a.execute-api.ap-south-1.amazonaws.com/prod/edit', // Using the same API ID from your test.js
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 60000 // 60 seconds timeout
      }
    );
    
    console.log('Success! Response:', response.data);
    
  } catch (error) {
    console.error('Error testing Lambda editor:');
    
    if (error.response) {
      console.error('Response error:', error.response.status, error.response.data);
    } else if (error.request) {
      console.error('Request error:', error.message);
    } else {
      console.error('Error:', error.message);
    }
  }
}

testLambdaEditor();