// supabase/functions/execute-agent/index.ts
// Supabase Edge Function that executes agent processing (replaces AWS Lambda)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const superMemeApiToken = Deno.env.get('SUPER_MEME_API_TOKEN') || ''

// Function to clean JSON from markdown code blocks
function cleanJsonFromMarkdown(text: string): string {
  if (!text) return text;
  
  const cleanedText = text
    .replace(/```json\\n/g, '')
    .replace(/```json\n/g, '')
    .replace(/```json/g, '')
    .replace(/```\\n/g, '')
    .replace(/```\n/g, '')
    .replace(/```/g, '')
    .replace(/\\n/g, '\n')
    .trim();
  
  return cleanedText;
}

// Function to extract a JSON object from a string
function extractJsonObject(str: string): any {
  if (!str) return null;
  const startIndex = str.indexOf('{');
  const endIndex = str.lastIndexOf('}');

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null;
  }

  const jsonStr = str.substring(startIndex, endIndex + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.log('Could not parse extracted substring as JSON.', e);
    return null;
  }
}

// Simplified function to extract description from API response
function extractDescription(data: any): string {
  if (!data) return 'No response data';
  
  const candidates = [
    data.result?.text,
    data.data?.analysis,
    data.result?.description,
    data.description,
    data.data,
    data.result,
    data.content,
    data.text,
    data.message
  ];
  
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  
  return typeof data === 'string' ? data : JSON.stringify(data);
}

serve(async (req) => {
  try {
    const body = await req.json()
    const agentId = body.agent_id || body.agentId;
    
    if (!agentId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing agent_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log('Starting analysis function for agent:', agentId);

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch agent configuration
    const { data: agents, error: agentError } = await supabase
      .from('agents2')
      .select('prompt, post_configuration, graphic, meme, video')
      .eq('id', agentId)
      .single()

    if (agentError || !agents) {
      throw new Error('Agent not found')
    }

    let postConfig: any = {}
    try {
      if (agents.post_configuration) {
        postConfig = typeof agents.post_configuration === 'string' 
          ? JSON.parse(agents.post_configuration) 
          : agents.post_configuration;
      }
    } catch (e) {
      throw new Error('Invalid post_configuration JSON')
    }

    const config = {
      systemPrompt: agents.prompt,
      topics: postConfig.topics,
      interval: postConfig.interval,
      graphic: agents.graphic === true,
      meme: agents.meme === true,
      video: agents.video === true
    }

    console.log('Agent configuration:', {
      graphic: config.graphic,
      meme: config.meme,
      video: config.video,
      topics: config.topics
    });

    // Get last 10 posts
    const { data: posts } = await supabase
      .from('terminal2')
      .select('tweet_content')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(10)

    const lastPosts = (posts || []).map((p: any) => p.tweet_content).join('\n')

    // Build enhanced system prompt
    let enhancedSystemPrompt = config.systemPrompt;
    enhancedSystemPrompt += '\n If there is an error in data, dont mention the error in your post and instead just tweet about something relevant to your character prompt. Dont repeat the content of your last 10 posts. Your last 10 posts are:\n' + lastPosts;

    if (config.video) {
      enhancedSystemPrompt += '\n\nIMPORTANT: You generate brainrot explainer videos. You must return your response in JSON format with the following structure: {"text": "content for video", "video_type": "minecraft OR glass OR subway", "caption": "tweet text here"}. The video_type must be one of: minecraft, glass, or subway. The caption will be posted as tweet text along with the video URL. The "text" field should be a normal paragraph, not a list or thread. CRITICAL: Keep the "text" field under 200 characters for video generation to work properly.';
    } else if (config.graphic) {
      enhancedSystemPrompt += '\n\nIMPORTANT: You must return your response in JSON format with the following structure: {"caption": "your tweet text here", "backgroundColor": "hex color or gradient", "textColor": "hex color", "text": "text to display on image"}. The caption will be posted as tweet text, and the other fields will be used to generate a graphic image.';
    }

    console.log('Calling analysis API with query:', 'Make a tweet about ' + config.topics);

    // Call the analysis API
    const analysisResponse = await fetch('https://analyze-slaz.onrender.com/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: config.topics,
        systemPrompt: enhancedSystemPrompt
      })
    })

    if (!analysisResponse.ok) {
      throw new Error(`Analysis API failed: ${analysisResponse.status}`)
    }

    const analysisData = await analysisResponse.json()
    console.log('API response received:', JSON.stringify(analysisData));

    // Process the response based on mode (video, graphic, or regular)
    let description: string, imageUrl: string | null = null, videoUrl: string | null = null;

    try {
      if (config.video) {
        const videoData = extractDescription(analysisData);
        const cleanedVideoData = cleanJsonFromMarkdown(videoData);
        const parsedVideoData = extractJsonObject(cleanedVideoData);

        if (parsedVideoData && parsedVideoData.text && parsedVideoData.video_type && parsedVideoData.caption) {
          description = parsedVideoData.caption;
          const text = parsedVideoData.text;
          const videoType = parsedVideoData.video_type;

          console.log('Extracted video data:', { text, videoType });

          try {
            const videoResponse = await fetch('https://video-generator-ynrv.onrender.com/process_video', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: text,
                video_name: videoType
              })
            });

            if (videoResponse.ok) {
              const videoData = await videoResponse.json();
              videoUrl = videoData.video_url;
              console.log('Generated video URL:', videoUrl);
            }
          } catch (videoError) {
            console.error('Failed to generate video:', videoError);
          }
        } else {
          description = videoData;
        }
      } else if (config.graphic) {
        const graphicData = extractDescription(analysisData);
        const cleanedGraphicData = cleanJsonFromMarkdown(graphicData);
        let parsedGraphicData = extractJsonObject(cleanedGraphicData);

        if (!parsedGraphicData) {
          try {
            parsedGraphicData = JSON.parse(cleanedGraphicData);
          } catch (parseError) {
            description = graphicData;
          }
        }

        if (parsedGraphicData && parsedGraphicData.caption) {
          description = parsedGraphicData.caption;
          const backgroundColor = parsedGraphicData.backgroundColor || parsedGraphicData.backgroundGradient || '#ffffff';
          const textColor = parsedGraphicData.textColor || '#000000';
          const text = parsedGraphicData.text || description;

          console.log('Extracted graphic data:', { backgroundColor, textColor, text });

          try {
            const mediaResponse = await fetch('https://media-api-f4zh.onrender.com/api/generate-text-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                backgroundColor: backgroundColor,
                textColor: textColor,
                text: text
              })
            });

            if (mediaResponse.ok) {
              const mediaData = await mediaResponse.json();
              imageUrl = mediaData.imageUrl || mediaData.url || mediaData.link;
              console.log('Generated image URL:', imageUrl);
            }
          } catch (mediaError) {
            console.error('Failed to generate image:', mediaError);
          }
        } else {
          description = graphicData;
        }
      } else {
        description = extractDescription(analysisData);
      }

      // Ensure description is a string and not too large
      if (typeof description !== 'string') {
        description = JSON.stringify(description);
      }
      if (description.length > 10000) {
        description = description.substring(0, 10000) + '... (truncated)';
      }
    } catch (error) {
      console.error('Error processing response:', error);
      description = 'Error processing analysis result';
    }

    // Helper function to insert to Supabase
    async function insertToSupabase(
      data: string, 
      isMeme: boolean = false, 
      memeUrl: string | null = null, 
      isGraphic: boolean = false, 
      graphicUrl: string | null = null
    ) {
      try {
        const payload: any = {
          agent_id: agentId,
          tweet_content: data,
          posted: false,
          created_at: new Date().toISOString()
        };

        if (isMeme && memeUrl) {
          payload.meme_url = memeUrl;
          payload.is_meme = true;
        }

        if (isGraphic && graphicUrl) {
          payload.image_url = graphicUrl;
          payload.is_graphic = true;
        }

        const { error } = await supabase
          .from('terminal2')
          .insert([payload]);

        if (error) {
          throw new Error('Supabase error: ' + error.message);
        }

        return { success: true };
      } catch (error: any) {
        console.error('Error in insertToSupabase:', error);
        return { success: false, error: error.message };
      }
    }

    // If this is a meme agent, call Super Meme API
    if (config.meme && description) {
      try {
        console.log('Calling Super Meme API for meme agent');
        
        const memeResponse = await fetch('https://app.supermeme.ai/api/v2/meme/image', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${superMemeApiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: description,
            count: 1
          })
        });

        if (!memeResponse.ok) {
          throw new Error(`Super Meme API request failed with status: ${memeResponse.status}`);
        }

        const memeData = await memeResponse.json();
        const memeUrls = memeData.memes || [];

        if (memeUrls && memeUrls.length > 0) {
          console.log('Generated', memeUrls.length, 'memes');

          for (const memeUrl of memeUrls) {
            try {
              const postResult = await insertToSupabase(description, true, memeUrl);
              if (postResult.success !== false) {
                console.log('Posted meme successfully:', memeUrl);
              }
            } catch (postError: any) {
              console.error('Error posting meme:', memeUrl, postError.message);
            }
          }

          return new Response(
            JSON.stringify({ 
              success: true, 
              action: 'generated_memes',
              memeCount: memeUrls.length
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } else {
          const result = await insertToSupabase(description);
          return new Response(
            JSON.stringify({ success: true, action: 'regular_post_fallback' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } catch (error: any) {
        console.error('Error with meme generation:', error);
        const result = await insertToSupabase(description);
        return new Response(
          JSON.stringify({ success: true, action: 'regular_post_fallback' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // For non-meme agents or if meme generation failed, store the content
    if (config.video && videoUrl) {
      const videoContent = description + ' ' + videoUrl;
      await insertToSupabase(videoContent);
      return new Response(
        JSON.stringify({ success: true, action: 'video_post', videoUrl: videoUrl }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } else if (config.graphic && imageUrl) {
      await insertToSupabase(description, false, null, true, imageUrl);
      return new Response(
        JSON.stringify({ success: true, action: 'graphic_post', imageUrl: imageUrl }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } else {
      await insertToSupabase(description);
      return new Response(
        JSON.stringify({ success: true, action: 'regular_post' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

