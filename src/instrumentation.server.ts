import * as Sentry from '@sentry/sveltekit';

// SvelteKit loads this file via Node's `--import` flag, BEFORE Vite's transform
// pipeline kicks in. That means `import.meta.env.DEV` is undefined here even
// during `npm run dev`, so the env tag was falling through to 'production' and
// localhost dev SSR errors were polluting the prod Sentry project (see
// MANKUNKU-7). `process.env.NODE_ENV` is set by Vite/SvelteKit in both modes
// and is observable from raw Node, so it detects the actual runtime mode.
const SENTRY_ENVIRONMENT =
  process.env.NODE_ENV === 'production' ? 'production' : 'development';

Sentry.init({
  dsn: 'https://a12d5e915778d470c90bf492a29f1bb4@o135479.ingest.us.sentry.io/4511259307081728',

  environment: SENTRY_ENVIRONMENT,

  // esbuild `Transform failed` errors during `npm run dev` are transient HMR
  // artifacts — they fire when the dev server tries to compile a file
  // mid-save (e.g. unresolved merge-conflict markers, in-progress edits).
  // Not actionable in dev; they cannot happen in production because the
  // bundle is pre-built. See MANKUNKU-7.
  ignoreErrors:
    SENTRY_ENVIRONMENT === 'development'
      ? [/Transform failed with \d+ error/i]
      : [],

  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: import.meta.env.DEV,
});
