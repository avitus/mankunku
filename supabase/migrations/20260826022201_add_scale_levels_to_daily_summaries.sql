-- Per-scale proficiency snapshot for the Scale Proficiency trend chart.
--
-- JSONB Partial<Record<ScaleType, number>>: every attempted scale's level
-- (1-100) at end of day, following the tonal_mastery snapshot pattern.
-- Durable here because progress.sessions is pruned at MAX_SESSIONS while
-- proficiency accumulates forever — without a daily snapshot the per-scale
-- trend line would erode to the pruned session window.
alter table public.daily_summaries
  add column scale_levels jsonb;
