const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { Scraper } = require('twitter-agent');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Add CORS middleware

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Function to fetch Twitter credentials
async function getTwitterCredentials(agentId) {
  const { data, error } = await supabase
    .from('agents2')
    .select('twitter_credentials, cookies')
    .eq('id', agentId)
    .single();

  if (error) {
    console.error('Error fetching Twitter credentials:', error);
    return null;
  }
  
  let credentials = {};
  
  // Parse twitter_credentials
  if (data?.twitter_credentials) {
    try {
      // Check if the credentials are stored as a string in env var format
      if (typeof data.twitter_credentials === 'string') {
        console.log('Credentials stored as string, parsing...');
        
        // Parse the credentials from the env var format
        const credentialLines = data.twitter_credentials.split('\n');
        
        credentialLines.forEach(line => {
          // Handle both KEY=value and KEY="value" formats
          const match = line.match(/^([^=]+)=(?:"([^"]*)"|([^"]*))$/);
          if (match) {
            const key = match[1].trim();
            const value = (match[2] !== undefined ? match[2] : match[3]).trim();
            
            // Convert the env var keys to our expected format
            if (key === 'TWITTER_USERNAME') credentials.username = value;
            else if (key === 'TWITTER_PASSWORD') credentials.password = value;
            else if (key === 'TWITTER_EMAIL') credentials.email = value;
            else if (key === 'TWITTER_2FA_SECRET') credentials.twoFactorSecret = value;
          }
        });
      } else {
        // Credentials are already in object format
        credentials = { ...data.twitter_credentials };
      }
    } catch (parseError) {
      console.error('Error parsing Twitter credentials:', parseError);
    }
  }
  
  // Add cookies from the separate column
  if (data?.cookies) {
    // Since cookies is now JSONB, it's already parsed as a JavaScript object
    credentials.cookies = data.cookies;
    console.log('Retrieved cookies from JSONB field:', 
      Array.isArray(credentials.cookies) ? 
        `${credentials.cookies.length} cookies` : 
        `cookies in ${typeof credentials.cookies} format`);
  }
  
  // Add agent_id
  credentials.agent_id = agentId;
  
  // Log what we have
  console.log('Retrieved credentials for agent', agentId, {
    hasUsername: !!credentials.username,
    hasPassword: !!credentials.password,
    hasEmail: !!credentials.email,
    hasTwoFactorSecret: !!credentials.twoFactorSecret,
    hasCookies: !!(credentials.cookies && credentials.cookies.length > 0)
  });
  
  if (!credentials.username || !credentials.password) {
    console.log('Missing required Twitter credentials for agent:', agentId);
    return null;
  }
  
  return credentials;
}

// Function to post tweet using twitter-agent with cookie-based authentication
async function postTweet(twitterCredentials, tweetContent) {
  let scraper = null; // Declare scraper outside the try block so it's accessible in the catch block
  
  try {
    // Check if twitterCredentials exists and has the necessary properties
    if (!twitterCredentials) {
      console.error('Twitter credentials are missing');
      return false;
    }

    const { username, password, email, twoFactorSecret, cookies, agent_id } = twitterCredentials;
    
    // Log credentials for debugging (remove sensitive info in production)
    console.log('Twitter credentials:', {
      username: username ? 'provided' : 'missing',
      password: password ? 'provided' : 'missing',
      email: email ? 'provided' : 'missing',
      twoFactorSecret: twoFactorSecret ? 'provided' : 'missing',
      cookies: cookies ? `${typeof cookies === 'string' ? 'text format' : Array.isArray(cookies) ? cookies.length + ' cookies' : 'unknown format'}` : 'no cookies',
      agent_id: agent_id || 'missing'
    });
    
    // If we have saved cookies, try to use them first
    if (cookies) {
      try {
        console.log('Attempting to use saved cookies...');
        
        // Handle different cookie formats - with JSONB, cookies should already be in the correct format
        let cookieArray;
        if (typeof cookies === 'string') {
          // If cookies is a string, try to parse it as JSON first
          try {
            cookieArray = JSON.parse(cookies);
          } catch (parseError) {
            // If not valid JSON, split by newlines or commas
            cookieArray = cookies.includes('\n') 
              ? cookies.split('\n').filter(c => c.trim()) 
              : cookies.split(',').map(c => c.trim());
          }
        } else if (Array.isArray(cookies)) {
          cookieArray = cookies;
        } else {
          throw new Error('Cookies are in an unsupported format');
        }
        
        console.log(`Processed ${cookieArray.length} cookies`);
        
        // Use the fromCookies method as documented
        scraper = await Scraper.fromCookies(cookieArray);
        
        // Test if cookies are still valid
        const isLoggedIn = await scraper.isLoggedIn();
        if (!isLoggedIn) {
          throw new Error('Cookies are invalid or expired');
        }
        console.log('Cookies are valid, using existing session');
      } catch (cookieError) {
        console.log('Cookies expired or invalid, logging in again:', cookieError.message);
        
        // Create scraper with options directly
        scraper = new Scraper({
          timeout: 120000,  // Longer timeout
          headless: false,  // Try with visible browser
          slowMo: 100       // Slow down operations
        });
        
        try {
          console.log('Attempting login with username and password (alternative method)...');
          const newCookies = await scraper.persistentLogin(username, password, email, twoFactorSecret);
          
          // Save the new cookies back to the database
          const cookieStrings = newCookies.map(cookie => cookie.toString());
          await updateTwitterCredentials(agent_id, cookieStrings);
        } catch (retryError) {
          console.error('Alternative login method also failed:', retryError);
          throw retryError;
        }
      }
    } else {
      // No cookies available, perform a fresh login
      console.log('No saved cookies, logging in to Twitter...');
      
      // Create scraper with options directly
      scraper = new Scraper({
        timeout: 120000,  // Longer timeout
        headless: false,  // Try with visible browser
        slowMo: 100       // Slow down operations
      });
      
      try {
        console.log(`Logging in with username: ${username}, email: ${email ? 'provided' : 'not provided'}`);
        const newCookies = await scraper.persistentLogin(username, password, email, twoFactorSecret);
        
        // Save the cookies for future use
        const cookieStrings = newCookies.map(cookie => cookie.toString());
        await updateTwitterCredentials(agent_id, cookieStrings);
      } catch (loginError) {
        console.error('Login error details:', loginError);
        
        // If we get the "Missing data" error, try an alternative approach
        if (loginError.message && loginError.message.includes('Missing data')) {
          console.log('Detected "Missing data" error, trying alternative approach...');
          
          // Create a new scraper with different options
          const altScraper = new Scraper({
            timeout: 180000,    // Even longer timeout
            headless: false,    // Non-headless mode
            slowMo: 200,        // Slower operations
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
          });
          
          try {
            const newCookies = await altScraper.persistentLogin(username, password, email, twoFactorSecret);
            const cookieStrings = newCookies.map(cookie => cookie.toString());
            await updateTwitterCredentials(agent_id, cookieStrings);
            
            // Use this scraper for the tweet
            scraper = altScraper;
          } catch (altError) {
            console.error('Alternative login approach also failed:', altError);
            throw new Error(`Twitter login failed with both approaches: ${loginError.message}`);
          }
        } else {
          throw new Error(`Twitter login failed: ${loginError.message}`);
        }
      }
    }
    
    // Send the tweet
    console.log('Sending tweet with content:', tweetContent);
    const tweetResult = await scraper.sendTweet(tweetContent);
    
    // Close the browser session after sending the tweet
    if (scraper && typeof scraper.close === 'function') {
      await scraper.close();
    } else if (scraper && scraper.browser && typeof scraper.browser.close === 'function') {
      // Try to close the browser directly if scraper.close doesn't exist
      await scraper.browser.close();
      console.log('Closed browser directly');
    }
    
    console.log('Tweet sent successfully!', tweetResult);
    return true;
  } catch (error) {
    console.error('Error posting tweet:', error);
    
    // Try to close the scraper if it exists
    try {
      if (scraper) {
        if (typeof scraper.close === 'function') {
          await scraper.close();
          console.log('Closed scraper successfully');
        } else if (scraper.browser && typeof scraper.browser.close === 'function') {
          // Try to close the browser directly if scraper.close doesn't exist
          await scraper.browser.close();
          console.log('Closed browser directly');
        } else {
          console.log('No close method found on scraper or browser');
        }
      }
    } catch (closeError) {
      console.error('Error closing browser after tweet failure:', closeError);
    }
    
    return false;
  }
}

// Function to update Twitter credentials with new cookies
async function updateTwitterCredentials(agentId, cookieStrings) {
  try {
    if (!agentId) {
      console.error('Cannot update Twitter credentials: Missing agent_id');
      return;
    }
    
    // Save cookies to the cookies column - with JSONB, we can store the array directly
    const { error: updateError } = await supabase
      .from('agents2')
      .update({ cookies: cookieStrings })
      .eq('id', agentId);
    
    if (updateError) {
      console.error('Error updating cookies:', updateError);
    } else {
      console.log('Cookies updated successfully for agent:', agentId);
    }
  } catch (error) {
    console.error('Error in updateTwitterCredentials:', error);
  }
}

// Function to get latest tweets for a user
async function getLatestTweets(scraper, username, count = 10, includeRetweets = false) {
  const tweets = [];
  try {
    const timeline = scraper.getTweets(username, count);
    
    for await (const tweet of timeline) {
      // Skip retweets and quote tweets
      if (!includeRetweets && (tweet.isRetweet || tweet.isQuoted)) {
        continue;
      }
      tweets.push(tweet);
      if (tweets.length >= count) {
        break;
      }
    }
    
    console.log(`Retrieved ${tweets.length} original tweets from @${username}`);
    return tweets;
  } catch (error) {
    console.error(`Error fetching tweets for @${username}:`, error);
    return [];
  }
}

// Function to get tweets for all users in reply_to_usernames
async function getTargetUserTweets(agentId) {
  try {
    // Fetch agent configuration
    const { data: agentData, error: agentError } = await supabase
      .from('agents2')
      .select('chat_configuration')
      .eq('id', agentId)
      .single();

    if (agentError) throw agentError;

    let chatConfig;
    try {
      chatConfig = typeof agentData.chat_configuration === 'string' 
        ? JSON.parse(agentData.chat_configuration)
        : agentData.chat_configuration;
    } catch (parseError) {
      console.error('Error parsing chat_configuration:', parseError);
      return [];
    }

    if (!chatConfig?.reply_to_usernames?.length) {
      console.log('No target usernames found in configuration');
      return [];
    }

    // Get Twitter credentials and set up scraper
    const credentials = await getTwitterCredentials(agentId);
    if (!credentials) {
      throw new Error('Failed to get Twitter credentials');
    }

    const scraper = await setupScraper(credentials);
    
    try {
      const allTweets = [];
      
      // Fetch tweets for each username
      for (const username of chatConfig.reply_to_usernames) {
        const userTweets = await getLatestTweets(scraper, username);
        allTweets.push(...userTweets);
      }

      // Close the scraper after we're done
      if (scraper?.close) {
        await scraper.close();
      }

      return allTweets;
    } catch (error) {
      throw error;
    } finally {
      // Ensure scraper is closed even if there's an error
      if (scraper?.close) {
        await scraper.close();
      }
    }
  } catch (error) {
    console.error('Error in getTargetUserTweets:', error);
    return [];
  }
}

// Function to get AI analysis for a tweet
async function getAIAnalysis(tweetText) {
  try {
    const response = await fetch('http://13.233.51.247:3004/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: tweetText,
        systemPrompt: "You are a helpful AI assistant. Analyze the tweet and provide a natural, engaging response. Keep responses concise and friendly. Don't use hashtags or emojis unless they were in the original tweet."
      })
    });

    if (!response.ok) {
      throw new Error('API request failed with status: ' + response.status);
    }

    const data = await response.json();
    
    // Extract the analysis from the nested response
    let analysis;
    if (data && typeof data === 'object') {
      if (data.data && data.data.analysis) {
        analysis = data.data.analysis;
      } else if (data.result && data.result.description) {
        analysis = data.result.description;
      } else if (data.description) {
        analysis = data.description;
      } else if (data.data && typeof data.data === 'string') {
        analysis = data.data;
      } else if (data.result && typeof data.result === 'string') {
        analysis = data.result;
      } else {
        analysis = JSON.stringify(data);
      }
    } else {
      analysis = String(data);
    }

    return analysis;
  } catch (error) {
    console.error('Error getting AI analysis:', error);
    return null;
  }
}

// Update the generateMentionReply function to use AI analysis
async function generateMentionReply(tweet) {
  try {
    const analysis = await getAIAnalysis(tweet.text || '');
    
    if (analysis) {
      // Ensure the reply starts with the username mention
      if (!analysis.startsWith(`@${tweet.username}`)) {
        return `@${tweet.username} ${analysis}`;
      }
      return analysis;
    }
    
    // Fallback to default responses if AI analysis fails
    let replyText = `@${tweet.username} `;
    const tweetText = tweet.text?.toLowerCase() || '';
    
    if (tweetText.includes('help') || tweetText.includes('how')) {
      replyText += "I'll be happy to help! Please provide more details.";
    } else if (tweetText.includes('thanks') || tweetText.includes('thank you')) {
      replyText += "You're welcome! Let me know if you need anything else.";
    } else if (tweetText.includes('question')) {
      replyText += "I'll do my best to answer your question. What would you like to know?";
    } else {
      replyText += "Thanks for reaching out! I appreciate your message.";
    }
    
    return replyText;
  } catch (error) {
    console.error('Error generating reply:', error);
    return `@${tweet.username} Thanks for reaching out!`;
  }
}

// Rate limiter helper
const rateLimiter = {
  lastRequest: 0,
  minDelay: 2000, // 2 seconds minimum between requests
  
  async wait() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;
    
    if (timeSinceLastRequest < this.minDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.minDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequest = Date.now();
  }
};

// Function to reply to mentions
async function replyToMentions(scraper, maxMentions = 10, delayMs = 2000, sinceHours = 24) {
  try {
    const { username } = await scraper.getMyInfo();
    if (!username) {
      throw new Error('Could not determine logged-in username');
    }

    const mentions = [];
    const now = Date.now();
    
    console.log(`Searching for mentions of @${username} in the last ${sinceHours} hours...`);
    
    // Search for recent mentions
    for await (const tweet of scraper.searchTweets(`@${username}`, maxMentions, SearchMode.Latest)) {
      // Skip tweets older than sinceHours
      if (tweet.timeParsed && 
          (now - tweet.timeParsed.getTime()) > (sinceHours * 60 * 60 * 1000)) {
        continue;
      }
      
      // Skip own tweets and already replied tweets
      if (tweet.username === username || 
          (tweet.isReply && tweet.inReplyToStatusId)) {
        continue;
      }
      
      // Basic spam check
      if (tweet.text?.toLowerCase().includes('win free') || 
          tweet.text?.toLowerCase().includes('click here')) {
        console.log(`Skipping potential spam tweet from @${tweet.username}`);
        continue;
      }
      
      mentions.push(tweet);
      if (mentions.length >= maxMentions) {
        break;
      }
    }

    console.log(`Found ${mentions.length} recent mentions to reply to`);

    // Reply to each valid mention
    for (const tweet of mentions) {
      if (!tweet.id) continue;

      try {
        await rateLimiter.wait(); // Respect rate limits
        
        const customReplyText = await generateMentionReply(tweet); // Note the await here
        await scraper.sendTweet(customReplyText, tweet.id);
        
        console.log(`✓ Replied to @${tweet.username}'s mention`);
        console.log(`  Original: ${tweet.text?.substring(0, 100)}...`);
        console.log(`  Reply: ${customReplyText}`);
        
        // Add additional delay between replies
        if (mentions.indexOf(tweet) < mentions.length - 1) {
          console.log(`Waiting ${delayMs}ms before next reply...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        console.error(`✗ Error replying to mention ${tweet.id}:`, error);
        continue;
      }
    }
    
    console.log('Finished processing mentions');
    
  } catch (error) {
    console.error('Error processing mentions:', error);
  }
}

// Update setupRealtimeSubscription to reply to fetched tweets
async function setupRealtimeSubscription() {
  const terminal2 = supabase
    .channel('custom-channel')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'terminal2'
      },
      async (payload) => {
        console.log('Change received!', payload);
        
        // Only process new records or records with status 'pending'
        if (payload.new && (payload.new.status === 'pending' || !payload.new.status)) {
          // Get the agent_id from the new/updated record
          const agentId = payload.new.agent_id;
          
          // Fetch corresponding Twitter credentials
          const twitterCredentials = await getTwitterCredentials(agentId);
          
          if (twitterCredentials) {
            console.log('Found Twitter credentials for agent:', agentId);
            const tweetContent = payload.new.tweet_content;
            
            if (!tweetContent) {
              console.error('Tweet content is empty or missing');
              await supabase
                .from('terminal2')
                .update({ status: 'failed', error_message: 'Tweet content is empty or missing' })
                .eq('id', payload.new.id);
              return;
            }
            
            console.log('Tweet content:', tweetContent);
            
            // Update status to processing
            await supabase
              .from('terminal2')
              .update({ status: 'processing' })
              .eq('id', payload.new.id);
            
            // Post the tweet using the credentials
            const success = await postTweet(twitterCredentials, tweetContent);
            
            if (success) {
              // Update the status in the database to "posted"
              await supabase
                .from('terminal2')
                .update({ status: 'posted', posted_at: new Date().toISOString() })
                .eq('id', payload.new.id);
              console.log('Database updated with posted status');
            } else {
              // Update the status to failed
              await supabase
                .from('terminal2')
                .update({ status: 'failed', error_message: 'Failed to post tweet' })
                .eq('id', payload.new.id);
              console.log('Database updated with failed status');
            }
          } else {
            console.log('No Twitter credentials found for agent:', agentId);
            await supabase
              .from('terminal2')
              .update({ status: 'failed', error_message: 'No Twitter credentials found' })
              .eq('id', payload.new.id);
          }
        } else {
          console.log('Skipping already processed record or record with non-pending status');
        }

        // Always fetch tweets when there's a new record
        if (payload.new && payload.new.agent_id) {
          const tweets = await getTargetUserTweets(payload.new.agent_id);
          console.log(`Fetched ${tweets.length} tweets from target users`);
          
          // Get credentials and setup scraper for replies
          const credentials = await getTwitterCredentials(payload.new.agent_id);
          if (credentials) {
            const scraper = await setupScraper(credentials);
            try {
              // Reply to each fetched tweet
              for (const tweet of tweets) {
                try {
                  await rateLimiter.wait(); // Respect rate limits
                  
                  // Get AI-generated reply
                  const analysis = await getAIAnalysis(tweet.text || '');
                  if (!analysis) continue;
                  
                  const replyText = `@${tweet.username} ${analysis}`;
                  await scraper.sendTweet(replyText, tweet.id);
                  
                  console.log(`✓ Replied to tweet from @${tweet.username}`);
                  console.log(`  Original: ${tweet.text?.substring(0, 100)}...`);
                  console.log(`  Reply: ${replyText}`);
                  
                  // Add delay between replies
                  await new Promise(resolve => setTimeout(resolve, 3000));
                } catch (error) {
                  console.error(`Error replying to tweet ${tweet.id}:`, error);
                  continue;
                }
              }
            } finally {
              if (scraper?.close) {
                await scraper.close();
              }
            }
          }
          
          // Process mentions after handling fetched tweets
          await replyToMentions(scraper, 10, 3000, 24);
        }
      }
    )
    .subscribe();
}

// Helper function to set up the scraper with cookies or login
async function setupScraper(twitterCredentials) {
  const { username, password, email, twoFactorSecret, cookies, agent_id } = twitterCredentials;
  
  let scraper;
  
  // If we have saved cookies, try to use them first
  if (cookies && (Array.isArray(cookies) ? cookies.length > 0 : cookies)) {
    try {
      console.log('Attempting to use saved cookies...');
      
      // Process cookies if needed
      let cookieArray = cookies;
      if (typeof cookies === 'string') {
        try {
          cookieArray = JSON.parse(cookies);
        } catch (parseError) {
          cookieArray = cookies.includes('\n') 
            ? cookies.split('\n').filter(c => c.trim()) 
            : cookies.split(',').map(c => c.trim());
        }
      }
      
      // Use the fromCookies method as documented
      scraper = await Scraper.fromCookies(cookieArray);
      
      // Test if cookies are still valid
      const isLoggedIn = await scraper.isLoggedIn();
      if (!isLoggedIn) {
        throw new Error('Cookies are invalid or expired');
      }
      
      console.log('Cookies are valid, using existing session');
      return scraper;
    } catch (cookieError) {
      console.log('Cookies expired or invalid, logging in again:', cookieError.message);
    }
  }
  
  // No valid cookies, perform a fresh login
  console.log('Logging in to Twitter...');
  
  // Create scraper with options
  scraper = new Scraper({
    timeout: 120000,
    headless: false,
    slowMo: 100
  });
  
  try {
    console.log(`Logging in with username: ${username}`);
    const newCookies = await scraper.persistentLogin(username, password, email, twoFactorSecret);
    
    // Save the cookies for future use if we have an agent_id
    if (agent_id) {
      const cookieStrings = newCookies.map(cookie => cookie.toString());
      await updateTwitterCredentials(agent_id, cookieStrings);
    }
    
    return scraper;
  } catch (loginError) {
    console.error('Login error:', loginError);
    throw new Error(`Twitter login failed: ${loginError.message}`);
  }
}

// Start the server and setup subscription
app.listen(port, async () => {
  try {
    console.log(`Server running on port ${port}`);
    await setupRealtimeSubscription();
    console.log('Realtime subscription setup complete');
  } catch (error) {
    console.error('Error during server startup:', error);
  }
});

// Add a global error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
