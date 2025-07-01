-- Migration script to fix agent_id data type in meme_queue table
-- Run this if you already created the table with TEXT agent_id

-- First, check if the table exists and has the wrong data type
DO $$
BEGIN
    -- Check if meme_queue table exists and agent_id is TEXT
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'meme_queue'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'meme_queue' 
        AND column_name = 'agent_id' 
        AND data_type = 'text'
    ) THEN
        -- Drop the table and recreate with correct schema
        RAISE NOTICE 'Dropping existing meme_queue table with incorrect schema...';
        DROP TABLE IF EXISTS meme_queue CASCADE;
        
        -- Recreate with correct schema
        CREATE TABLE meme_queue (
            id BIGSERIAL PRIMARY KEY,
            agent_id BIGINT NOT NULL,
            meme_url TEXT NOT NULL,
            original_tweet TEXT NOT NULL,
            posted BOOLEAN DEFAULT FALSE,
            post_order INTEGER NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            posted_at TIMESTAMP WITH TIME ZONE
        );
        
        -- Recreate indexes
        CREATE INDEX idx_meme_queue_agent_posted ON meme_queue (agent_id, posted);
        CREATE INDEX idx_meme_queue_agent_order ON meme_queue (agent_id, post_order);
        
        RAISE NOTICE 'meme_queue table recreated with correct BIGINT agent_id';
    ELSE
        RAISE NOTICE 'meme_queue table schema is already correct or table does not exist';
    END IF;
END
$$; 