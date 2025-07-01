-- Create meme_queue table for storing meme URLs and managing posting intervals
CREATE TABLE IF NOT EXISTS meme_queue (
    id BIGSERIAL PRIMARY KEY,
    agent_id BIGINT NOT NULL,
    meme_url TEXT NOT NULL,
    original_tweet TEXT NOT NULL,
    posted BOOLEAN DEFAULT FALSE,
    post_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    posted_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_meme_queue_agent_posted ON meme_queue (agent_id, posted);
CREATE INDEX IF NOT EXISTS idx_meme_queue_agent_order ON meme_queue (agent_id, post_order);

-- Add meme-related columns to terminal2 table if they don't exist
ALTER TABLE terminal2 
ADD COLUMN IF NOT EXISTS meme_url TEXT,
ADD COLUMN IF NOT EXISTS is_meme BOOLEAN DEFAULT FALSE;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_terminal2_meme ON terminal2 (agent_id, is_meme);

-- Add meme column to agents2 table if it doesn't exist
ALTER TABLE agents2 
ADD COLUMN IF NOT EXISTS meme BOOLEAN DEFAULT FALSE; 