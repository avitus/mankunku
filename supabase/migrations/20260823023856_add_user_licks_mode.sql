-- A lick's mode, major or minor. NULL means "not stated" — legacy rows and
-- licks that never declared one; the app resolves those by harmony
-- inference (src/lib/music/mode.ts lickMode). `key` stays the TONIC pitch
-- class: a D-minor lick is key 'D' + mode 'minor', never its relative major.
ALTER TABLE public.user_licks
  ADD COLUMN IF NOT EXISTS mode TEXT NULL
  CHECK (mode IS NULL OR mode IN ('major', 'minor'));

COMMENT ON COLUMN public.user_licks.mode IS
  'major | minor | NULL (not stated; resolved by harmony inference on the client)';
