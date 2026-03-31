ALTER TABLE public.user_settings
  ADD COLUMN highest_note INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.user_settings.highest_note IS
  'User-configured highest concert pitch MIDI. NULL = instrument default.';
