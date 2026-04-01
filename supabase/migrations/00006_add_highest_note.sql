ALTER TABLE public.user_settings
  ADD COLUMN highest_note INTEGER DEFAULT NULL
  CONSTRAINT user_settings_highest_note_midi_range_check
    CHECK (highest_note IS NULL OR highest_note BETWEEN 0 AND 127);

COMMENT ON COLUMN public.user_settings.highest_note IS
  'User-configured highest concert pitch MIDI. NULL = instrument default.';
