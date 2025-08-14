const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { Scraper, SpaceParticipant, SttTtsPlugin } = require('twitter-agent');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { URL } = require('url');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Add CORS middleware

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to safely parse JSON configuration
function safeParseConfiguration(configData, configType = 'configuration', agentId = 'unknown') {
  if (!configData) {
    console.log(`⚠️ No ${configType} found for agent:`, agentId);
    return {};
  }

  if (typeof configData === 'object') {
    return configData;
  }

  if (typeof configData === 'string') {
    try {
      console.log(`🔍 Parsing ${configType} for agent ${agentId}:`, configData.substring(0, 100) + '...');
      return JSON.parse(configData);
    } catch (parseError) {
      console.error(`❌ Error parsing ${configType} for agent:`, agentId);
      console.error('Parse error:', parseError.message);
      
      // Show context around the error position
      const pos = parseInt(parseError.message.match(/\d+/)?.[0]) || 0;
      const start = Math.max(0, pos - 50);
      const end = Math.min(configData.length, pos + 50);
      console.log(`🔍 Problematic ${configType} context:`, configData.substring(start, end));
      
      // Return empty object as fallback
      console.log(`🔄 Using empty ${configType} as fallback`);
      return {};
    }
  }

  console.log(`⚠️ Unexpected ${configType} data type:`, typeof configData);
  return {};
}

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
      // Handle the new JSON format
      const rawCredentials = typeof data.twitter_credentials === 'string' 
        ? JSON.parse(data.twitter_credentials)
        : data.twitter_credentials;

      // Map the credentials to the expected format
      credentials = {
        username: rawCredentials['TWITTER_USERNAME='] || rawCredentials['TWITTER_USERNAME'],
        password: rawCredentials['TWITTER_PASSWORD='] || rawCredentials['TWITTER_PASSWORD'],
        email: rawCredentials['TWITTER_EMAIL='] || rawCredentials['TWITTER_EMAIL'],
        twoFactorSecret: rawCredentials['TWITTER_2FA_SECRET='] || rawCredentials['TWITTER_2FA_SECRET']
      };
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

// Function to intelligently break long text into tweet-sized chunks
function breakIntoTweetChunks(text, maxLength = 270) {
  const originalText = text.trim();
  
  // If content is above 200 characters, split into sentence-based tweets
  if (originalText.length > 200) {
    console.log(`📝 Content is ${originalText.length} characters, splitting into sentence-based thread`);
    return breakIntoSentenceBasedTweets(originalText, maxLength);
  }
  
  // For shorter content, use the original chunking logic
  return breakIntoRegularChunks(originalText, maxLength);
}

// Function to break content into sentence-based tweets
function breakIntoSentenceBasedTweets(text, maxLength = 270) {
  const effectiveMaxLength = maxLength;
  
  // Check if this is a reply (starts with @username)
  const isReply = text.startsWith('@');
  let mentionPart = '';
  let contentText = text;
  
  if (isReply) {
    // Extract the mention part to ensure it stays in the first tweet
    const spaceIndex = text.indexOf(' ');
    if (spaceIndex !== -1) {
      mentionPart = text.substring(0, spaceIndex + 1);
      contentText = text.substring(spaceIndex + 1);
    }
  }
  
  // Split content into sentences
  const sentences = contentText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  const chunks = [];
  
  for (let i = 0; i < sentences.length; i++) {
    let sentence = sentences[i].trim();
    
    // Add mention to first sentence if this is a reply
    if (i === 0 && isReply) {
      sentence = mentionPart + sentence;
    }
    
    // If a single sentence is too long, break it down further
    if (sentence.length > effectiveMaxLength) {
      const subChunks = breakIntoRegularChunks(sentence, maxLength);
      chunks.push(...subChunks);
    } else {
      chunks.push(sentence);
    }
  }
  
  console.log(`📝 Created ${chunks.length} sentence-based tweets`);
  return chunks;
}

// Function to break content using the original chunking logic
function breakIntoRegularChunks(text, maxLength = 270) {
  const effectiveMaxLength = maxLength;
  
  if (text.length <= effectiveMaxLength) {
    return [text];
  }

  const chunks = [];
  let remainingText = text.trim();
  
  // Check if this is a reply (starts with @username)
  const isReply = remainingText.startsWith('@');
  let mentionPart = '';
  
  if (isReply) {
    // Extract the mention part to ensure it stays in the first tweet
    const spaceIndex = remainingText.indexOf(' ');
    if (spaceIndex !== -1) {
      mentionPart = remainingText.substring(0, spaceIndex + 1);
      remainingText = remainingText.substring(spaceIndex + 1);
    }
  }

  while (remainingText.length > 0) {
    // Calculate available space for this chunk
    const availableSpace = chunks.length === 0 && isReply ? 
      effectiveMaxLength - mentionPart.length : effectiveMaxLength;
    
    if (remainingText.length <= availableSpace) {
      const finalChunk = chunks.length === 0 && isReply ? 
        mentionPart + remainingText : remainingText;
      chunks.push(finalChunk);
      break;
    }

    // Try to break at sentence boundaries first
    let breakPoint = -1;
    const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    
    for (let i = availableSpace; i >= availableSpace * 0.6; i--) {
      const char = remainingText.substring(i - 1, i + 1);
      if (sentenceEnders.some(ender => char === ender || char.endsWith(ender.trim()))) {
        breakPoint = i;
        break;
      }
    }

    // If no sentence boundary found, try paragraph breaks
    if (breakPoint === -1) {
      for (let i = availableSpace; i >= availableSpace * 0.6; i--) {
        if (remainingText.substring(i - 1, i + 1) === '\n\n') {
          breakPoint = i;
          break;
        }
      }
    }

    // If no paragraph break, try line breaks
    if (breakPoint === -1) {
      for (let i = availableSpace; i >= availableSpace * 0.6; i--) {
        if (remainingText.charAt(i) === '\n') {
          breakPoint = i + 1;
          break;
        }
      }
    }

    // If no good break point, try word boundaries
    if (breakPoint === -1) {
      for (let i = availableSpace; i >= availableSpace * 0.7; i--) {
        if (remainingText.charAt(i) === ' ') {
          breakPoint = i;
          break;
        }
      }
    }

    // Last resort: hard break at available space
    if (breakPoint === -1) {
      breakPoint = availableSpace;
    }

    let chunk = remainingText.substring(0, breakPoint).trim();
    
    // Add mention to first chunk if this is a reply
    if (chunks.length === 0 && isReply) {
      chunk = mentionPart + chunk;
    }
    
    chunks.push(chunk);
    remainingText = remainingText.substring(breakPoint).trim();
  }

  return chunks;
}

// Robust function to create Twitter threads with proper ID verification
async function createThread(scraper, threadContent, options = {}) {
  const { delayBetweenTweets = 3000, indexingDelay = 10000, mediaData } = options;
  let previousTweetId = null;

  for (let i = 0; i < threadContent.length; i++) {
    const tweetText = threadContent[i];
    console.log(`Posting tweet ${i + 1}/${threadContent.length}: "${tweetText.substring(0, 80)}${tweetText.length > 80 ? '...' : ''}"`);
    
    // Only attach media to the first tweet in a thread
    const mediaForTweet = (i === 0 && mediaData) ? mediaData : undefined;
    if (mediaForTweet) {
      console.log(`📎 Attaching ${mediaForTweet.length} media file(s) to first tweet`);
    }
    
    const tweetResult = await scraper.sendTweet(
      tweetText,
      i === 0 ? null : previousTweetId,
      mediaForTweet
    );

    try {
      console.log(`⏳ Waiting ${indexingDelay/1000} seconds for tweet indexing...`);
      await new Promise((resolve) => setTimeout(resolve, indexingDelay));

      if (tweetResult?.id) {
        previousTweetId = tweetResult.id;
        console.log(`✅ Tweet ${i + 1}/${threadContent.length} posted with ID: ${previousTweetId}`);
      } else {
        console.log(`🔍 No tweet ID in response, searching recent tweets for verification...`);
        const username = await scraper
          .me()
          .then((profile) => profile?.username);
        if (!username) {
          throw new Error('Failed to get username');
        }
        const recentTweets = scraper.getTweets(username, 5);
        for await (const tweet of recentTweets) {
          if (tweet.text.includes(tweetText.substring(0, 30))) {
            previousTweetId = tweet.id;
            console.log(`✅ Tweet ${i + 1}/${threadContent.length} found with ID: ${previousTweetId}`);
            break;
          }
        }
      }

      if (!previousTweetId) {
        throw new Error(`Failed to verify tweet #${i + 1}`);
      }

      if (i < threadContent.length - 1) {
        console.log(`⏳ Waiting ${delayBetweenTweets/1000} seconds before next tweet...`);
        await new Promise((resolve) => setTimeout(resolve, delayBetweenTweets));
      }
    } catch (error) {
      throw new Error(`Failed to post tweet #${i + 1}: ${error.message}`);
    }
  }

  return previousTweetId;
}

// Robust function to create reply threads with proper ID verification
async function createReplyThread(scraper, threadContent, originalTweetId, options = {}) {
  const { delayBetweenTweets = 3000, indexingDelay = 8000, mediaData } = options;
  let currentReplyToId = originalTweetId;

  for (let i = 0; i < threadContent.length; i++) {
    const tweetText = threadContent[i];
    console.log(`📤 Posting reply ${i + 1}/${threadContent.length}: "${tweetText.substring(0, 80)}${tweetText.length > 80 ? '...' : ''}"`);
    
    // Only attach media to the first reply in a thread
    const mediaForReply = (i === 0 && mediaData) ? mediaData : undefined;
    if (mediaForReply) {
      console.log(`📎 Attaching ${mediaForReply.length} media file(s) to first reply`);
    }
    
    const tweetResult = await scraper.sendTweet(tweetText, currentReplyToId, mediaForReply);

    try {
      console.log(`⏳ Waiting ${indexingDelay/1000} seconds for reply indexing...`);
      await new Promise((resolve) => setTimeout(resolve, indexingDelay));

      if (tweetResult?.id) {
        currentReplyToId = tweetResult.id;
        console.log(`✅ Reply ${i + 1}/${threadContent.length} posted with ID: ${currentReplyToId}`);
      } else {
        console.log(`🔍 No reply ID in response, searching recent tweets for verification...`);
        const username = await scraper
          .me()
          .then((profile) => profile?.username);
        if (!username) {
          throw new Error('Failed to get username');
        }
        const recentTweets = scraper.getTweets(username, 5);
        for await (const tweet of recentTweets) {
          if (tweet.text.includes(tweetText.substring(0, 30))) {
            currentReplyToId = tweet.id;
            console.log(`✅ Reply ${i + 1}/${threadContent.length} found with ID: ${currentReplyToId}`);
            break;
          }
        }
      }

      if (!currentReplyToId) {
        console.log(`⚠️ Failed to verify reply #${i + 1}, using original tweet ID as fallback`);
        currentReplyToId = originalTweetId;
      }

      if (i < threadContent.length - 1) {
        console.log(`⏳ Waiting ${delayBetweenTweets/1000} seconds before next reply...`);
        await new Promise((resolve) => setTimeout(resolve, delayBetweenTweets));
      }
    } catch (error) {
      console.error(`Warning: Failed to verify reply #${i + 1}: ${error.message}`);
      // Continue with the original tweet ID as fallback
      currentReplyToId = originalTweetId;
    }
  }

  return currentReplyToId;
}

// Enhanced function to post tweet or thread using twitter-agent
async function postTweet(twitterCredentials, tweetContent) {
  let scraper = null;
  
  try {
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

    scraper = await setupScraper(twitterCredentials);
    
    // Get the full tweet content (not just first paragraph)
    let fullContent = tweetContent.trim();
    
    // Remove quotes from the beginning and end of the tweet content
    if (fullContent.startsWith('"') && fullContent.endsWith('"')) {
      fullContent = fullContent.substring(1, fullContent.length - 1);
    }
    
    // Filter out emojis and hashtags
    fullContent = filterEmojisAndHashtags(fullContent);
    
    // Process media from Supabase links
    const { cleanContent, mediaData } = await processMediaFromContent(fullContent);
    
    // Break content into appropriate chunks
    const tweetChunks = breakIntoTweetChunks(cleanContent);
    
    console.log(`\n📝 CONTENT BREAKDOWN:`);
    console.log(`Content will be posted as ${tweetChunks.length} tweet(s)`);
    if (mediaData.length > 0) {
      console.log(`📎 Media attachments: ${mediaData.length} file(s)`);
      mediaData.forEach((media, i) => {
        console.log(`  Media ${i + 1}: ${media.mediaType} (${media.data.length} bytes)`);
      });
    }
    if (tweetChunks.length > 1) {
      tweetChunks.forEach((chunk, i) => {
        console.log(`Chunk ${i + 1}: "${chunk.substring(0, 50)}..."`);
      });
    }
    console.log(`\n🚀 STARTING TWEET POSTING:`);
    
    if (tweetChunks.length === 1) {
      // Single tweet with potential media
      console.log('Posting single tweet:', tweetChunks[0]);
      const result = await scraper.sendTweet(tweetChunks[0], null, mediaData.length > 0 ? mediaData : undefined);
      console.log('✨ Tweet posted successfully!');
    } else {
      // Thread posting with media only on first tweet
      console.log('🧵 Posting thread with', tweetChunks.length, 'tweets');
      
      try {
        await createThread(scraper, tweetChunks, { 
          delayBetweenTweets: 3000, 
          indexingDelay: 10000,
          mediaData: mediaData.length > 0 ? mediaData : undefined
        });
        console.log('🎉 Thread posting completed!');
      } catch (threadError) {
        console.error('❌ Error during thread posting:', threadError);
        throw threadError;
      }
    }

    // Close browser after tweets are sent
    if (scraper?.close) {
      await scraper.close();
    }

    return true;

  } catch (error) {
    console.error('Error posting tweet/thread:', error);
    
    // Try to close the scraper if it exists
    try {
      if (scraper) {
        if (typeof scraper.close === 'function') {
          await scraper.close();
          console.log('Closed scraper successfully');
        } else if (scraper.browser && typeof scraper.browser.close === 'function') {
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

// Function to get latest tweets for a user (now includes quote tweets)
async function getLatestTweets(scraper, username, count = 10, includeRetweets = false, includeQuoteTweets = true) {
  const tweets = [];
  try {
    const timeline = scraper.getTweets(username, count * 2); // Get more to account for filtering
    
    for await (const tweet of timeline) {
      // Skip retweets unless explicitly requested
      if (tweet.isRetweet && !includeRetweets) {
        continue;
      }
      
      // Include quote tweets by default since we can now handle them
      if (tweet.isQuoted && !includeQuoteTweets) {
        continue;
      }
      
      tweets.push(tweet);
      if (tweets.length >= count) {
        break;
      }
    }
    
    const tweetTypes = tweets.map(t => {
      if (t.isRetweet) return 'RT';
      if (t.isQuoted) return 'QT';
      return 'Original';
    });
    
    console.log(`Retrieved ${tweets.length} tweets from @${username} (Types: ${tweetTypes.join(', ')})`);
    return tweets;
  } catch (error) {
    console.error(`Error fetching tweets for @${username}:`, error);
    return [];
  }
}

// Update getTargetUserTweets to remove Spaces logic
async function getTargetUserTweets(agentId) {
  try {
    // Fetch agent configuration including post_configuration
    const { data: agentData, error: agentError } = await supabase
      .from('agents2')
      .select('chat_configuration, post_configuration')
      .eq('id', agentId)
      .single();

    if (agentError) throw agentError;

    // Parse configurations using helper function
    const chatConfig = safeParseConfiguration(agentData.chat_configuration, 'chat_configuration', agentId);
    const postConfig = safeParseConfiguration(agentData.post_configuration, 'post_configuration', agentId);

    if (!chatConfig?.reply_to_usernames?.length) {
      console.log('No target usernames found in configuration');
      return [];
    }

    // Get interval from post_configuration (default to 30 minutes if not specified)
    const intervalMinutes = postConfig?.interval || 120;
    console.log(`Using interval of ${intervalMinutes} minutes`);

    // Get Twitter credentials and set up scraper
    const credentials = await getTwitterCredentials(agentId);
    if (!credentials) {
      throw new Error('Failed to get Twitter credentials');
    }

    const scraper = await setupScraper(credentials);
    
    try {
      const allTweets = [];
      const cutoffTime = new Date(Date.now() - intervalMinutes * 60 * 1000);
      
      for (const username of chatConfig.reply_to_usernames) {
        // Get tweets
        const userTweets = await getLatestTweets(scraper, username);
        
        // Filter tweets by interval
        const recentTweets = userTweets.filter(tweet => {
          return tweet.timeParsed && tweet.timeParsed > cutoffTime;
        });
        
        allTweets.push(...recentTweets);
      }

      // Close the scraper after we're done
      if (scraper?.close) {
        await scraper.close();
      }

      console.log(`Found ${allTweets.length} tweets within the last ${intervalMinutes} minutes`);
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

// Function to extract comprehensive tweet content including quoted tweets
function extractTweetContent(tweet) {
  let fullContent = tweet.text || '';
  let contextInfo = {
    hasQuotedTweet: false,
    quotedAuthor: null,
    quotedText: null,
    isReply: tweet.isReply || false,
    replyToUsername: null,
    tweetType: 'original'
  };

  // Determine tweet type
  if (tweet.isRetweet) {
    contextInfo.tweetType = 'retweet';
  } else if (tweet.isQuoted) {
    contextInfo.tweetType = 'quote_tweet';
  } else if (tweet.isReply) {
    contextInfo.tweetType = 'reply';
  }

  // Handle quoted tweets - check multiple possible structures
  let quotedTweetData = null;
  
  if (tweet.quotedTweet) {
    quotedTweetData = tweet.quotedTweet;
  } else if (tweet.quotedStatus) {
    quotedTweetData = tweet.quotedStatus;
  } else if (tweet.quoted_status) {
    quotedTweetData = tweet.quoted_status;
  } else if (tweet.retweetedTweet && tweet.isQuoted) {
    // Sometimes quoted tweets are stored in retweetedTweet
    quotedTweetData = tweet.retweetedTweet;
  }

  if (quotedTweetData) {
    contextInfo.hasQuotedTweet = true;
    contextInfo.quotedAuthor = quotedTweetData.username || quotedTweetData.user?.screen_name || quotedTweetData.user?.username;
    contextInfo.quotedText = quotedTweetData.text || quotedTweetData.full_text;
    
    if (contextInfo.quotedAuthor && contextInfo.quotedText) {
      // Append quoted content to main content for analysis
      fullContent += `\n\n[QUOTED TWEET by @${contextInfo.quotedAuthor}]: ${contextInfo.quotedText}`;
      console.log(`📄 Extracted quoted tweet from @${contextInfo.quotedAuthor}`);
    }
  }

  // Handle reply context
  if (tweet.isReply) {
    contextInfo.replyToUsername = tweet.inReplyToUsername || tweet.in_reply_to_screen_name;
  }

  // Additional context extraction
  if (tweet.urls && tweet.urls.length > 0) {
    contextInfo.hasUrls = true;
  }
  
  if (tweet.hashtags && tweet.hashtags.length > 0) {
    contextInfo.hasHashtags = true;
  }

  return { fullContent, contextInfo };
}

// Enhanced function to get AI analysis for a tweet with context
async function getAIAnalysis(tweet) {
  try {
    const { fullContent, contextInfo } = extractTweetContent(tweet);
    
    // Filter out emojis and hashtags from the content before AI analysis
    const cleanedContent = filterEmojisAndHashtags(fullContent);
    
    // Create enhanced system prompt based on context
    let systemPrompt = "You are a helpful AI assistant. Analyze the tweet and provide a natural, engaging response under 200 characters no hashtags and do not mention any errors or warnings whatsoever.";
    
    if (contextInfo.hasQuotedTweet) {
      systemPrompt += ` The tweet is a QUOTE TWEET that includes content from @${contextInfo.quotedAuthor}. The user is sharing someone else's tweet with their own commentary. Consider BOTH the user's commentary AND the quoted content when crafting your response. You can:
      - Respond to the user's opinion/commentary about the quoted tweet
      - Add your perspective on the quoted content
      - Find connections between the user's take and the original content
      - Acknowledge both the user's insight and the quoted material
      Make your response relevant to this quote tweet context.`;
    }
    
    if (contextInfo.isReply) {
      systemPrompt += " This appears to be part of a conversation thread. Keep your response conversational and contextually appropriate to continue the discussion and no errors or warnings whatsoever.";
    }
    
    if (contextInfo.tweetType === 'retweet') {
      systemPrompt += " This is a retweet, so the user is sharing someone else's content. Frame your response acknowledging that they found this content worth sharing.";
    }

    console.log('Analyzing tweet with full context:', {
      hasQuotedTweet: contextInfo.hasQuotedTweet,
      quotedAuthor: contextInfo.quotedAuthor,
      isReply: contextInfo.isReply,
      contentLength: fullContent.length
    });

    const response = await fetch('https://analyze-slaz.onrender.com/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: cleanedContent,
        systemPrompt: systemPrompt
      })
    });

    if (!response.ok) {
      throw new Error('API request failed with status: ' + response.status);
    }

    const data = await response.json();
    
    // Handle error responses
    if (data.error) {
      console.error('AI analysis error:', data.error);
      return null;
    }
    
    // Extract the analysis, handling various response formats
    let analysis = null;
    if (data.data?.analysis) {
      analysis = data.data.analysis;
    } else if (data.result?.description) {
      analysis = data.result.description;
    } else if (typeof data.data === 'string') {
      analysis = data.data;
    } else if (typeof data.result === 'string') {
      analysis = data.result;
    }

    // Validate the analysis
    if (!analysis || typeof analysis !== 'string') {
      console.error('Invalid AI analysis response:', data);
      return null;
    }

    return { analysis, contextInfo };
  } catch (error) {
    console.error('Error getting AI analysis:', error);
    return null;
  }
}

// Function to post a reply or reply thread
async function postReplyOrThread(scraper, replyContent, originalTweetId, delayMs = 3000) {
  try {
    // Process media from Supabase links in reply content
    const { cleanContent, mediaData } = await processMediaFromContent(replyContent);
    
    // Break reply into chunks if needed
    const replyChunks = breakIntoTweetChunks(cleanContent);
    
    if (replyChunks.length === 1) {
      // Single reply with potential media
      console.log(`📤 Posting single reply: "${replyChunks[0]}"`);
      if (mediaData.length > 0) {
        console.log(`📎 Attaching ${mediaData.length} media file(s) to reply`);
      }
      await scraper.sendTweet(replyChunks[0], originalTweetId, mediaData.length > 0 ? mediaData : undefined);
      return true;
    } else {
      // Reply thread using robust createThread approach
      console.log(`🧵 Posting reply thread with ${replyChunks.length} tweets`);
      
      try {
        await createReplyThread(scraper, replyChunks, originalTweetId, { 
          delayBetweenTweets: delayMs, 
          indexingDelay: 8000,
          mediaData: mediaData.length > 0 ? mediaData : undefined
        });
        console.log('🎉 Reply thread posting completed!');
        return true;
      } catch (threadError) {
        console.error('❌ Error during reply thread posting:', threadError);
        return false;
      }
    }
  } catch (error) {
    console.error('❌ Error posting reply thread:', error);
    return false;
  }
}

// Enhanced generateMentionReply function with improved context handling
async function generateMentionReply(tweet) {
  try {
    console.log(`\n🤖 Generating reply for @${tweet.username}...`);
    
    // Get AI analysis with enhanced context
    const aiResult = await getAIAnalysis(tweet);
    
    if (aiResult && aiResult.analysis) {
      const { analysis, contextInfo } = aiResult;
      
      // Log context information
      if (contextInfo.hasQuotedTweet) {
        console.log(`📝 Tweet contains quoted content from @${contextInfo.quotedAuthor}`);
      }
      
      // Ensure the reply starts with the username mention
      let finalReply = analysis;
      if (!analysis.startsWith(`@${tweet.username}`)) {
        finalReply = `@${tweet.username} ${analysis}`;
      }
      
      // Check if reply will need threading
      const chunks = breakIntoTweetChunks(finalReply);
      if (chunks.length > 1) {
        console.log(`📝 AI generated a long response that will be posted as ${chunks.length} tweets in a thread`);
      }
      
      console.log(`✨ AI-generated reply: "${finalReply.substring(0, 100)}${finalReply.length > 100 ? '...' : ''}"`);
      return finalReply;
    }
    
    // Enhanced fallback logic with context awareness
    console.log('⚠️ AI analysis failed, using enhanced fallback logic...');
    
    const { fullContent, contextInfo } = extractTweetContent(tweet);
    
    // Filter out emojis and hashtags for better reply generation
    const cleanedContent = filterEmojisAndHashtags(fullContent);
    let replyText = `@${tweet.username} `;
    const tweetText = cleanedContent.toLowerCase();
    
    // Context-aware fallback responses
    if (contextInfo.hasQuotedTweet) {
      if (tweetText.includes('agree') || tweetText.includes('disagree')) {
        replyText += "Interesting perspective on this topic! Thanks for sharing.";
      } else if (tweetText.includes('what do you think') || tweetText.includes('thoughts')) {
        replyText += "That's a thought-provoking quote tweet! I appreciate you sharing your take.";
      } else {
        replyText += "Thanks for sharing this with your commentary!";
      }
    } else if (tweetText.includes('help') || tweetText.includes('how')) {
      replyText += "I'll be happy to help! Please provide more details.";
    } else if (tweetText.includes('thanks') || tweetText.includes('thank you')) {
      replyText += "You're welcome! Let me know if you need anything else.";
    } else if (tweetText.includes('question')) {
      replyText += "I'll do my best to answer your question. What would you like to know?";
    } else if (tweetText.includes('opinion') || tweetText.includes('think')) {
      replyText += "That's an interesting point! I appreciate you sharing your thoughts.";
    } else if (contextInfo.isReply) {
      replyText += "Thanks for continuing the conversation!";
    } else {
      replyText += "Thanks for reaching out! I appreciate your message.";
    }
    
    console.log(`🔄 Fallback reply: "${replyText}"`);
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
async function replyToMentions(scraper, credentials, maxMentions = 10, delayMs = 2000, intervalMinutes = 120) {
  try {
    const myUsername = credentials.username;
    console.log('=== Starting replyToMentions ===');
    console.log(`Bot username: @${myUsername}`);
    console.log(`Max mentions to process: ${maxMentions}`);
    console.log(`Delay between replies: ${delayMs}ms`);
    console.log(`Looking back: ${intervalMinutes} minutes`);

    if (!myUsername) {
      console.error('ERROR: No username found in credentials:', credentials);
      throw new Error('Could not determine logged-in username');
    }

    const mentions = [];
    const now = Date.now();
    const query = `@${myUsername}`;
    
    console.log(`\n🔍 Searching for mentions using query: "${query}"`);
    
    // Search for recent mentions with more debug logging
    let skippedCount = { old: 0, self: 0, replied: 0, spam: 0 };
    let rawTweetCount = 0;
    
    try {
      // Use searchTweets with maxMentions parameter and searchMode 1 (Latest)
      for await (const tweet of scraper.searchTweets(query, maxMentions, 1)) {
        rawTweetCount++;
        console.log(`\n[DEBUG] Raw tweet ${rawTweetCount}:`, {
          id: tweet.id,
          username: tweet.username,
          text: tweet.text?.substring(0, 50),
          isReply: tweet.isReply,
          isQuoted: tweet.isQuoted,
          isRetweet: tweet.isRetweet,
          hasQuotedTweet: !!(tweet.quotedTweet || tweet.quotedStatus),
          quotedAuthor: tweet.quotedTweet?.username || tweet.quotedStatus?.username,
          inReplyToStatusId: tweet.inReplyToStatusId,
          timeParsed: tweet.timeParsed
        });
        
        // Skip own tweets
        if (tweet.username === myUsername) {
          skippedCount.self++;
          console.log('  🤖 Skipped: Own tweet');
          continue;
        }

        // Skip tweets older than intervalMinutes
        if (tweet.timeParsed && 
            (now - tweet.timeParsed.getTime()) > (intervalMinutes * 60 * 1000)) {
          skippedCount.old++;
          console.log('  ⏰ Skipped: Tweet too old');
          continue;
        }
        
        // Basic spam check
        if (tweet.text?.toLowerCase().includes('win free') || 
            tweet.text?.toLowerCase().includes('click here')) {
          skippedCount.spam++;
          console.log('  🚫 Skipped: Potential spam');
          continue;
        }
        
        console.log('  ✅ Tweet accepted for reply');
        mentions.push(tweet);
      }
    } catch (searchError) {
      console.error('\n❌ Error during tweet search:', searchError);
    }

    console.log('\n=== Search Results ===');
    console.log(`Total tweets found: ${rawTweetCount}`);
    console.log(`Found ${mentions.length} valid mentions to reply to`);
    console.log('Skipped tweets:', skippedCount);

    // Reply to each valid mention
    console.log('\n=== Starting Replies ===');
    for (const tweet of mentions) {
      if (!tweet.id) {
        console.log('⚠️ Skipping tweet with no ID');
        continue;
      }

      try {
        const tweetType = tweet.isRetweet ? 'retweet' : 
                         tweet.isQuoted ? 'quote tweet' : 
                         tweet.isReply ? 'reply' : 'original tweet';
        
        console.log(`\n📝 Processing reply to @${tweet.username} (${tweetType})`);
        console.log(`Original tweet: "${tweet.text?.substring(0, 100)}..."`);
        
        if (tweet.quotedTweet || tweet.quotedStatus) {
          const quotedAuthor = tweet.quotedTweet?.username || tweet.quotedStatus?.username;
          const quotedText = tweet.quotedTweet?.text || tweet.quotedStatus?.text;
          console.log(`📄 Quoted content from @${quotedAuthor}: "${quotedText?.substring(0, 80)}..."`);
        }
        
        await rateLimiter.wait();
        console.log('Rate limit respected');
        
        const customReplyText = await generateMentionReply(tweet);
        console.log(`Generated reply: "${customReplyText.substring(0, 100)}${customReplyText.length > 100 ? '...' : ''}"`);
        
        // Use postReplyOrThread to handle long replies
        const replySuccess = await postReplyOrThread(scraper, customReplyText, tweet.id, delayMs);
        if (replySuccess) {
          console.log('✨ Reply sent successfully');
        } else {
          console.log('❌ Failed to send reply');
        }
        
        if (mentions.indexOf(tweet) < mentions.length - 1) {
          console.log(`⏳ Waiting ${delayMs}ms before next reply...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        console.error(`❌ Error replying to tweet ${tweet.id}:`, error);
        continue;
      }
    }
    
    console.log('\n=== Finished Processing Mentions ===');
    console.log(`Successfully processed ${mentions.length} mentions`);
    
  } catch (error) {
    console.error('\n❌ Fatal error in replyToMentions:', error);
  }
}

// Function to handle replies to your tweets
async function handleTweetReplies(scraper, credentials, maxTweets = 5, delayMs = 2000, intervalMinutes = 30) {
  try {
    const myUsername = credentials.username;
    console.log('=== Starting handleTweetReplies ===');
    console.log(`Bot username: @${myUsername}`);
    console.log(`Max tweets to check: ${maxTweets}`);
    console.log(`Delay between replies: ${delayMs}ms`);
    console.log(`Looking back: ${intervalMinutes} minutes`);

    if (!myUsername) {
      console.error('ERROR: No username found in credentials:', credentials);
      throw new Error('Could not determine logged-in username');
    }

    // Get your recent tweets
    const myTweets = [];
    console.log(`\n🔍 Fetching recent tweets for @${myUsername}...`);
    
    try {
      for await (const tweet of scraper.getTweetsAndReplies(myUsername, maxTweets)) {
        // Only include tweets by the bot
        if (tweet.username === myUsername) {
          myTweets.push(tweet);
          console.log(`Found tweet: "${tweet.text?.substring(0, 50)}..."`);
        }
      }
    } catch (searchError) {
      console.error('\n❌ Error fetching tweets:', searchError);
    }

    console.log(`\nFound ${myTweets.length} of your tweets to check for replies`);

    // Process each tweet and its replies
    for (const tweet of myTweets) {
      console.log(`\n📝 Checking replies for tweet: ${tweet.id}`);
      console.log(`Original tweet: "${tweet.text?.substring(0, 100)}..."`);

      try {
        // Use searchTweets to find replies to this tweet
        const replies = [];
        const replyQuery = `to:${myUsername} conversation_id:${tweet.id}`;
        
        for await (const reply of scraper.searchTweets(replyQuery, 10, 1)) {
          // Skip own replies and the original tweet
          if (reply.username !== myUsername && reply.id !== tweet.id) {
            replies.push(reply);
          }
        }
        
        console.log(`Found ${replies.length} replies to check`);

        // Process each reply
        for (const reply of replies) {
          // Skip if the reply mentions the agent (will be handled by mentions system)
          if (reply.text?.includes(`@${myUsername}`)) {
            console.log(`  🔄 Skipping reply from @${reply.username} - contains mention, will be handled by mentions system`);
            continue;
          }

          // Check if we've already replied to this tweet
          const hasReplied = await hasAlreadyReplied(scraper, reply.id, myUsername);
          if (hasReplied) {
            console.log(`  ↩️ Already replied to @${reply.username}'s tweet`);
            continue;
          }

          console.log(`\n  💬 Processing reply from @${reply.username}`);
          console.log(`  Reply text: "${reply.text?.substring(0, 100)}..."`);

          // Add time filter for replies
          const now = Date.now();
          if (reply.timeParsed && 
              (now - reply.timeParsed.getTime()) > (intervalMinutes * 60 * 1000)) {
            console.log(`  ⏰ Skipped: Reply too old from @${reply.username}`);
            continue;
          }

          // Generate and send reply
          await rateLimiter.wait();
          const customReplyText = await generateMentionReply(reply);
          console.log(`  Generated response: "${customReplyText.substring(0, 100)}${customReplyText.length > 100 ? '...' : ''}"`);

          const replySuccess = await postReplyOrThread(scraper, customReplyText, reply.id, delayMs);
          if (replySuccess) {
            console.log(`  ✨ Reply sent successfully`);
          } else {
            console.log(`  ❌ Failed to send reply`);
          }

          // Add delay between replies
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (replyError) {
        console.error(`❌ Error processing replies for tweet ${tweet.id}:`, replyError);
        continue;
      }

      // Add longer delay between processing different tweets
      await new Promise(resolve => setTimeout(resolve, delayMs * 2.5));
    }

    console.log('\n=== Finished Processing Tweet Replies ===');
  } catch (error) {
    console.error('\n❌ Fatal error in handleTweetReplies:', error);
  }
}

// Update hasAlreadyReplied to use searchTweets instead
async function hasAlreadyReplied(scraper, tweetId, myUsername) {
  try {
    const replyQuery = `from:${myUsername} conversation_id:${tweetId}`;
    for await (const reply of scraper.searchTweets(replyQuery, 1, 1)) {
      if (reply.username === myUsername) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error(`Error checking for existing replies to ${tweetId}:`, error);
    return false;
  }
}

// Update setupRealtimeSubscription to include target user tweet checks
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
          const credentials = await getTwitterCredentials(payload.new.agent_id);
          if (credentials) {
            let scraper = null;
            try {
              scraper = await setupScraper(credentials);
              
              // Get interval from post_configuration
              const { data: agentData } = await supabase
                .from('agents2')
                .select('post_configuration')
                .eq('id', payload.new.agent_id)
                .single();

              const postConfig = safeParseConfiguration(agentData?.post_configuration, 'post_configuration', payload.new.agent_id);

              const intervalMinutes = postConfig?.interval || 30;
              
              console.log('\n=== Starting Periodic Checks ===');
              
              // Pass intervalMinutes to all checks
              console.log('\n📨 Checking mentions...');
              await replyToMentions(scraper, credentials, 10, 3000, intervalMinutes);
              
              console.log('\n💬 Checking replies to our tweets...');
              await handleTweetReplies(scraper, credentials, 5, 3000, intervalMinutes);
              
              // getTargetUserTweets already uses intervalMinutes
              console.log('\n🎯 Checking target users\' tweets...');
              const targetTweets = await getTargetUserTweets(payload.new.agent_id);
              
              // Process and reply to target tweets
              for (const tweet of targetTweets) {
                try {
                  // Check if we've already replied
                  const hasReplied = await hasAlreadyReplied(scraper, tweet.id, credentials.username);
                  if (hasReplied) {
                    console.log(`Already replied to @${tweet.username}'s tweet`);
                    continue;
                  }

                  const tweetType = tweet.isRetweet ? 'retweet' : 
                                   tweet.isQuoted ? 'quote tweet' : 
                                   tweet.isReply ? 'reply' : 'original tweet';
                  
                  console.log(`\n🎯 Processing target user tweet from @${tweet.username} (${tweetType})`);
                  console.log(`Tweet content: "${tweet.text?.substring(0, 100)}..."`);
                  
                  if (tweet.quotedTweet || tweet.quotedStatus) {
                    const quotedAuthor = tweet.quotedTweet?.username || tweet.quotedStatus?.username;
                    const quotedText = tweet.quotedTweet?.text || tweet.quotedStatus?.text;
                    console.log(`📄 Quoted content from @${quotedAuthor}: "${quotedText?.substring(0, 80)}..."`);
                  }

                  // Generate and send reply
                  await rateLimiter.wait();
                  const customReplyText = await generateMentionReply(tweet);
                  console.log(`Generated reply: "${customReplyText.substring(0, 100)}${customReplyText.length > 100 ? '...' : ''}"`);

                  const replySuccess = await postReplyOrThread(scraper, customReplyText, tweet.id, 3000);
                  if (replySuccess) {
                    console.log('✨ Reply sent successfully');
                  } else {
                    console.log('❌ Failed to send reply');
                  }

                  // Add delay between replies
                  await new Promise(resolve => setTimeout(resolve, 3000));
                } catch (replyError) {
                  console.error(`❌ Error replying to target tweet:`, replyError);
                  continue;
                }
              }
              
              console.log('\n=== Completed All Checks ===');
              
            } catch (error) {
              console.error('Error during periodic checks:', error);
            } finally {
              if (scraper?.close) {
                await scraper.close();
              }
            }
          }
        }
      }
    )
    .subscribe();
}

// Helper function to filter out emojis and hashtags
function filterEmojisAndHashtags(content) {
  if (!content || typeof content !== 'string') {
    return content;
  }
  
  // Remove emojis (Unicode emoji characters)
  let filtered = content.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
  
  // Remove hashtags (words starting with #)
  filtered = filtered.replace(/#\w+/g, '');
  
  // Remove multiple spaces and trim
  filtered = filtered.replace(/\s+/g, ' ').trim();
  
  return filtered;
}

// Helper function to detect Supabase links in tweet content
function detectSupabaseLinks(content) {
  const supabaseUrlPattern = /https?:\/\/[a-zA-Z0-9-]+\.supabase\.co\/storage\/v1\/object\/[^\s]+/g;
  return content.match(supabaseUrlPattern) || [];
}

// Helper function to download media from URL
async function downloadMedia(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    
    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download media: ${response.statusCode}`));
        return;
      }
      
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Helper function to determine MIME type from URL or content
function getMimeType(url, buffer) {
  // First try to determine from URL extension
  const urlPath = new URL(url).pathname.toLowerCase();
  const extension = path.extname(urlPath);
  
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm'
  };
  
  if (mimeTypes[extension]) {
    return mimeTypes[extension];
  }
  
  // Fallback: check buffer magic numbers
  if (buffer) {
    const header = buffer.toString('hex', 0, 4);
    if (header.startsWith('ffd8')) return 'image/jpeg';
    if (header.startsWith('8950')) return 'image/png';
    if (header.startsWith('4749')) return 'image/gif';
    if (header.startsWith('0000')) return 'video/mp4';
  }
  
  // Default fallback
  return 'application/octet-stream';
}

// Helper function to process media from Supabase links
async function processMediaFromContent(content) {
  const supabaseLinks = detectSupabaseLinks(content);
  
  if (supabaseLinks.length === 0) {
    return { cleanContent: content, mediaData: [] };
  }
  
  console.log(`📎 Found ${supabaseLinks.length} Supabase media link(s)`);
  
  const mediaData = [];
  let cleanContent = content;
  
  for (const link of supabaseLinks) {
    try {
      console.log(`📥 Downloading media from: ${link}`);
      const buffer = await downloadMedia(link);
      const mimeType = getMimeType(link, buffer);
      
      console.log(`✅ Downloaded ${buffer.length} bytes, MIME type: ${mimeType}`);
      
      // Check file size limits
      const maxVideoSize = 512 * 1024 * 1024; // 512MB
      const maxImageSize = 5 * 1024 * 1024; // 5MB reasonable limit for images
      
      if (mimeType.startsWith('video/') && buffer.length > maxVideoSize) {
        console.log(`⚠️ Video file too large: ${buffer.length} bytes (max: ${maxVideoSize})`);
        continue;
      }
      
      if (mimeType.startsWith('image/') && buffer.length > maxImageSize) {
        console.log(`⚠️ Image file too large: ${buffer.length} bytes (max: ${maxImageSize})`);
        continue;
      }
      
      mediaData.push({
        data: buffer,
        mediaType: mimeType
      });
      
      // Remove the Supabase link from the content
      cleanContent = cleanContent.replace(link, '').trim();
      
      // Twitter limits: max 4 images OR 1 video
      if (mimeType.startsWith('video/') || mediaData.length >= 4) {
        break;
      }
      
    } catch (error) {
      console.error(`❌ Failed to download media from ${link}:`, error.message);
      continue;
    }
  }
  
  // Clean up any extra whitespace
  cleanContent = cleanContent.replace(/\s+/g, ' ').trim();
  
  console.log(`📝 Processed ${mediaData.length} media file(s)`);
  console.log(`📄 Clean content: "${cleanContent}"`);
  
  return { cleanContent, mediaData };
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
