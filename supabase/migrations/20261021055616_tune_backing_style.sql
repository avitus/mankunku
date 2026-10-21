-- The chart marking remains free text; playback consumes this supported style.
alter table public.tunes add column backing_style text
  check (backing_style in ('swing', 'bossa-nova', 'ballad', 'straight'));
comment on column public.tunes.backing_style is
  'Saved accompaniment style. NULL legacy rows derive it from the chart marking.';

-- Personal choices for read-only catalog/community tunes use the existing
-- owner-only settings RLS and durable settings outbox. Keys are stable tune IDs.
alter table public.user_settings add column tune_backing_styles jsonb not null default '{}'::jsonb
  check (jsonb_typeof(tune_backing_styles) = 'object');
comment on column public.user_settings.tune_backing_styles is
  'Personal backing style overrides keyed by tune ID; never changes a shared tune.';
