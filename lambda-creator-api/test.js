const axios = require('axios');

// Helper function to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testLambdaCreator() {
  // Generate a unique timestamp for this test (numeric only)
  const timestamp = Date.now();
  
  // Try multiple times with increasing delays
  const maxRetries = 1;
  let retryCount = 0;
  let success = false;
  
  // Initial delay before first attempt

  
  while (retryCount < maxRetries && !success) {
    try {
      console.log(`Attempt ${retryCount + 1} of ${maxRetries}...`);
      
      // Create a simpler payload with properly formatted data
      const payload = {
        userId: timestamp,
        interval: 2,
        query: "What is Bitcoin?", // Simpler query
        systemPrompt: "You are a helpful assistant."
      };
      
      console.log('Sending payload:', JSON.stringify(payload));
      
      const response = await axios.post(
        'https://97m15gg62a.execute-api.ap-south-1.amazonaws.com/prod/create',
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 60000 // Increase timeout to 60 seconds
        }
      );
      
      console.log('Success! Response:', response.data);
      success = true;
      
    } catch (error) {
      console.error(`Attempt ${retryCount + 1} failed.`);
      
      if (error.response) {
        console.error('Response error:', error.response.status, error.response.data);
      } else if (error.request) {
        console.error('Request error:', error.message);
      } else {
        console.error('Error:', error.message);
      }
      
      retryCount++;
      if (retryCount < maxRetries) {
        const waitTime = 15000 * retryCount; // Increase wait time with each retry
        console.log(`Waiting ${waitTime/1000} seconds before next attempt...`);
        await sleep(waitTime);
      } else {
        console.error('Max retries reached.');
      }
    }
  }
}

testLambdaCreator();