const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const FormData = require('form-data');
const mime = require('mime-types');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// LinkedIn API constants
const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';
const LINKEDIN_HEADERS = {
  'X-Restli-Protocol-Version': '2.0.0',
  'Content-Type': 'application/json'
};

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

// Function to fetch LinkedIn credentials
async function getLinkedInCredentials(agentId) {
  const { data, error } = await supabase
    .from('agents2')
    .select('linkedin_token')
    .eq('id', agentId)
    .single();

  if (error) {
    console.error('Error fetching LinkedIn credentials:', error);
    return null;
  }
  
  if (!data?.linkedin_token) {
    console.log('No LinkedIn token found for agent:', agentId);
    return null;
  }

  console.log('Retrieved LinkedIn credentials for agent', agentId);
  return {
    token: data.linkedin_token,
    agent_id: agentId
  };
}

// Function to get LinkedIn person/organization URN
async function getLinkedInAuthorUrn(token) {
  try {
    // First try to get person profile
    const response = await axios.get(`${LINKEDIN_API_BASE}/people/(id~)`, {
      headers: {
        ...LINKEDIN_HEADERS,
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.data && response.data.id) {
      return `urn:li:person:${response.data.id}`;
    }
  } catch (error) {
    console.log('Could not get person URN, trying organizations:', error.response?.status);
    
    // If person fails, try to get organization
    try {
      const orgResponse = await axios.get(`${LINKEDIN_API_BASE}/organizationAcls?q=roleAssignee`, {
        headers: {
          ...LINKEDIN_HEADERS,
          'Authorization': `Bearer ${token}`
        }
      });

      if (orgResponse.data && orgResponse.data.elements && orgResponse.data.elements.length > 0) {
        const org = orgResponse.data.elements[0];
        return org.organization;
      }
    } catch (orgError) {
      console.error('Could not get organization URN:', orgError.response?.status);
    }
  }
  
  throw new Error('Could not determine LinkedIn author URN');
}

// Function to check if URL is a Supabase media link
function isSupabaseMediaLink(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('supabase') || url.includes('supabase');
  } catch {
    return false;
  }
}

// Function to determine media type
function getMediaType(url) {
  const mimeType = mime.lookup(url);
  if (!mimeType) return 'unknown';
  
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'unknown';
}

// Function to upload media to LinkedIn
async function uploadMediaToLinkedIn(token, mediaUrl, authorUrn) {
  try {
    console.log('🎨 Uploading media to LinkedIn:', mediaUrl);
    
    const mediaType = getMediaType(mediaUrl);
    let recipe;
    
    if (mediaType === 'image') {
      recipe = 'urn:li:digitalmediaRecipe:feedshare-image';
    } else if (mediaType === 'video') {
      recipe = 'urn:li:digitalmediaRecipe:feedshare-video';
    } else {
      throw new Error(`Unsupported media type: ${mediaType}`);
    }

    // Step 1: Register upload
    console.log('📝 Registering upload with LinkedIn...');
    const registerResponse = await axios.post(`${LINKEDIN_API_BASE}/assets?action=registerUpload`, {
      registerUploadRequest: {
        recipes: [recipe],
        owner: authorUrn,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }
        ]
      }
    }, {
      headers: {
        ...LINKEDIN_HEADERS,
        'Authorization': `Bearer ${token}`
      }
    });

    const uploadUrl = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const assetId = registerResponse.data.value.asset;

    console.log('📤 Upload URL received, uploading media...');

    // Step 2: Download media from Supabase
    const mediaResponse = await axios.get(mediaUrl, { responseType: 'stream' });
    
    // Step 3: Upload to LinkedIn
    await axios.put(uploadUrl, mediaResponse.data, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': mime.lookup(mediaUrl) || 'application/octet-stream'
      }
    });

    console.log('✅ Media uploaded successfully:', assetId);
    return assetId;
  } catch (error) {
    console.error('❌ Error uploading media to LinkedIn:', error.response?.data || error.message);
    throw error;
  }
}

// Function to post to LinkedIn
async function postToLinkedIn(credentials, tweetContent) {
  try {
    console.log('🔄 Posting to LinkedIn...');
    console.log('Content:', tweetContent.substring(0, 100) + '...');

    const authorUrn = await getLinkedInAuthorUrn(credentials.token);
    console.log('Author URN:', authorUrn);

    // Check if content has Supabase media links
    const supabaseLinks = [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = tweetContent.match(urlRegex) || [];
    
    for (const url of urls) {
      if (isSupabaseMediaLink(url)) {
        supabaseLinks.push(url);
      }
    }

    let media = [];
    let shareMediaCategory = 'NONE';

    // Process media if found
    if (supabaseLinks.length > 0) {
      console.log('📎 Found Supabase media links:', supabaseLinks.length);
      
      for (const mediaUrl of supabaseLinks) {
        try {
          const assetId = await uploadMediaToLinkedIn(credentials.token, mediaUrl, authorUrn);
          const mediaType = getMediaType(mediaUrl);
          
          media.push({
            status: 'READY',
            media: assetId,
            title: {
              text: 'Shared Media'
            }
          });

          // Set the share media category based on first media type
          if (shareMediaCategory === 'NONE') {
            shareMediaCategory = mediaType === 'image' ? 'IMAGE' : 'VIDEO';
          }
        } catch (uploadError) {
          console.error('❌ Failed to upload media:', mediaUrl, uploadError.message);
        }
      }
    }

    // Remove media URLs from text content
    let cleanContent = tweetContent;
    supabaseLinks.forEach(link => {
      cleanContent = cleanContent.replace(link, '').trim();
    });

    // Prepare the LinkedIn post payload
    const postPayload = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: cleanContent
          },
          shareMediaCategory: shareMediaCategory,
          media: media
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    };

    console.log('📝 Posting to LinkedIn with payload:', JSON.stringify(postPayload, null, 2));

    // Post to LinkedIn
    const response = await axios.post(`${LINKEDIN_API_BASE}/ugcPosts`, postPayload, {
      headers: {
        ...LINKEDIN_HEADERS,
        'Authorization': `Bearer ${credentials.token}`
      }
    });

    console.log('✅ LinkedIn post successful!');
    console.log('Response headers:', response.headers);
    console.log('Post ID:', response.headers['x-restli-id']);

    return true;
  } catch (error) {
    console.error('❌ Error posting to LinkedIn:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      console.error('🔑 LinkedIn token may be invalid or expired');
    }
    return false;
  }
}

// Setup realtime subscription
async function setupRealtimeSubscription() {
  const terminal2 = supabase
    .channel('linkedin-handler-channel')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'terminal2'
      },
      async (payload) => {
        console.log('📨 Change received!', payload);
        
        // Only process new records or records with status 'pending'
        if (payload.new && (payload.new.status === 'pending' || !payload.new.status)) {
          // Get the agent_id from the new/updated record
          const agentId = payload.new.agent_id;
          
          // Fetch corresponding LinkedIn credentials
          const linkedinCredentials = await getLinkedInCredentials(agentId);
          
          if (linkedinCredentials) {
            console.log('🔗 Found LinkedIn credentials for agent:', agentId);
            const tweetContent = payload.new.tweet_content;
            
            if (!tweetContent) {
              console.error('❌ Tweet content is empty or missing');
              await supabase
                .from('terminal2')
                .update({ status: 'failed', error_message: 'Tweet content is empty or missing' })
                .eq('id', payload.new.id);
              return;
            }
            
            console.log('📝 Tweet content:', tweetContent);
            
            // Update status to processing
            await supabase
              .from('terminal2')
              .update({ status: 'processing' })
              .eq('id', payload.new.id);
            
            // Post to LinkedIn using the credentials
            const success = await postToLinkedIn(linkedinCredentials, tweetContent);
            
            if (success) {
              // Update the status in the database to "posted"
              await supabase
                .from('terminal2')
                .update({ status: 'posted', posted_at: new Date().toISOString() })
                .eq('id', payload.new.id);
              console.log('✅ Database updated with posted status');
            } else {
              // Update the status to failed
              await supabase
                .from('terminal2')
                .update({ status: 'failed', error_message: 'Failed to post to LinkedIn' })
                .eq('id', payload.new.id);
              console.log('❌ Database updated with failed status');
            }
          } else {
            console.log('🔑 No LinkedIn credentials found for agent:', agentId);
            await supabase
              .from('terminal2')
              .update({ status: 'failed', error_message: 'No LinkedIn credentials found' })
              .eq('id', payload.new.id);
          }
        } else {
          console.log('⏭️ Skipping already processed record or record with non-pending status');
        }
      }
    )
    .subscribe();
}

// Start the server and setup subscription
app.listen(port, async () => {
  try {
    console.log(`🚀 LinkedIn Handler server running on port ${port}`);
    await setupRealtimeSubscription();
    console.log('👂 Realtime subscription setup complete');
  } catch (error) {
    console.error('❌ Error during server startup:', error);
  }
});

// Add a global error handler
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚫 Unhandled Rejection at:', promise, 'reason:', reason);
}); 