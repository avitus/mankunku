-- The tempo a user last chose for each tune (tune desk or practice setup), so a
-- tune reopens at it. Personal for every tune, own charts included: tempo is
-- how this player practises the chart, not a property of the chart. Keys are
-- stable tune IDs; same owner-only RLS and settings outbox as the styles.
alter table public.user_settings add column tune_tempos jsonb not null default '{}'::jsonb
  check (jsonb_typeof(tune_tempos) = 'object');
comment on column public.user_settings.tune_tempos is
  'Personal tempos (BPM) keyed by tune ID; never changes a shared tune.';
