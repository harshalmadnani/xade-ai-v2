-- Migration script to add Vercel cron scheduling support
-- Run this in your Supabase SQL editor

-- Add columns needed for Vercel cron scheduling
ALTER TABLE agents2 
ADD COLUMN IF NOT EXISTS last_run TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS edge_function_url TEXT,
ADD COLUMN IF NOT EXISTS eventbridge_interval INTEGER,
ADD COLUMN IF NOT EXISTS eventbridge_status TEXT,
ADD COLUMN IF NOT EXISTS eventbridge_rule TEXT;

-- Extract interval from post_configuration JSON and populate eventbridge_interval
-- This handles existing agents that have interval in post_configuration
UPDATE agents2 
SET eventbridge_interval = (
  CASE 
    WHEN post_configuration IS NOT NULL THEN
      (post_configuration::json->>'interval')::INTEGER
    ELSE NULL
  END
)
WHERE eventbridge_interval IS NULL AND post_configuration IS NOT NULL;

-- Create index for efficient cron queries
CREATE INDEX IF NOT EXISTS idx_agents2_active_interval 
ON agents2(is_active, eventbridge_interval) 
WHERE is_active = true AND eventbridge_interval IS NOT NULL;

-- Migrate existing agent_trigger to edge_function_url for backward compatibility
UPDATE agents2 
SET edge_function_url = agent_trigger 
WHERE edge_function_url IS NULL AND agent_trigger IS NOT NULL;

-- Set all existing agents as active by default
UPDATE agents2 
SET is_active = true 
WHERE is_active IS NULL;

