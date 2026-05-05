import * as Sentry from '@sentry/sveltekit';

Sentry.init({
  dsn: 'https://a12d5e915778d470c90bf492a29f1bb4@o135479.ingest.us.sentry.io/4511259307081728',

  // Tag events with the actual environment so `vite dev` SSR errors don't
  // pollute production. The SDK defaults to 'production' when unset, which
  // leaks SvelteKit dev-watcher races and Vite SSR resolver misses into the
  // prod project (see Sentry MANKUNKU-B/E).
  environment: import.meta.env.DEV ? 'development' : 'production',

  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: import.meta.env.DEV,
});