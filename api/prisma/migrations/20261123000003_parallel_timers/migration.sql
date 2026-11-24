-- Parallel timers (06 §2.2, TT3): a member may have several live entries, at most one per task.
-- The limit of 5 live entries per member is checked by the service under an advisory lock.
DROP INDEX one_live_timer;
CREATE UNIQUE INDEX one_live_timer_per_task ON time_entries (member_id, task_id)
  WHERE state <> 'stopped' AND deleted_at IS NULL;
