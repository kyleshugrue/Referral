-- PostgreSQL LISTEN/NOTIFY trigger for event-driven job processing
-- This trigger emits a notification whenever a new job is inserted into matchGenerationJobs
-- The worker will LISTEN for these notifications instead of polling the database

-- Create the notification function
CREATE OR REPLACE FUNCTION notify_job_queued()
RETURNS TRIGGER AS $$
BEGIN
  -- Emit NOTIFY with job details as JSON payload
  PERFORM pg_notify(
    'job_queued',
    json_build_object(
      'id', NEW.id,
      'userId', NEW.user_id,
      'jobType', NEW.job_type,
      'priority', NEW.priority,
      'createdAt', NEW.created_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger on matchGenerationJobs table
DROP TRIGGER IF EXISTS job_queued_trigger ON "matchGenerationJobs";
CREATE TRIGGER job_queued_trigger
  AFTER INSERT ON "matchGenerationJobs"
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_queued();

-- Verify trigger is installed
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'job_queued_trigger';
