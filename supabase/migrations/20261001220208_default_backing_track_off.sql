-- New settings rows start with metronome only. Preserve existing preferences.
ALTER TABLE public.user_settings
  ALTER COLUMN backing_track_enabled SET DEFAULT false;
