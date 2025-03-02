const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { Scraper } = require('twitter-agent');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

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
        scraper = await Scraper.fromCookies(cookieArray);
        
        // Test if cookies are still valid
        await scraper.testLogin();
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

// Set up real-time subscription
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
      scraper = await Scraper.fromCookies(cookies);
      
      // Test if cookies are still valid
      await scraper.testLogin();
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
  console.log(`Server running on port ${port}`);
  await setupRealtimeSubscription();
  console.log('Realtime subscription setup complete');
});
