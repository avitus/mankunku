import { handleErrorWithSentry, replayIntegration } from "@sentry/sveltekit";
import * as Sentry from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit';

Sentry.init({
  dsn: 'https://a12d5e915778d470c90bf492a29f1bb4@o135479.ingest.us.sentry.io/4511259307081728',

  // Tag events with the actual environment so dev sessions on localhost don't
  // pollute production. The SDK defaults to 'production' when this is unset,
  // which leaks every HMR/compile glitch from `npm run dev` into the prod
  // project (see Sentry MANKUNKU-6/D/1/C/F/7/B/E).
  environment: import.meta.env.DEV ? 'development' : 'production',

  // Route envelopes through a same-origin endpoint so ad blockers and
  // Firefox ETP don't cancel them. See src/routes/api/monitoring/+server.ts.
  tunnel: '/api/monitoring',

  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // If the entire session is not sampled, use the below sample rate to sample
  // sessions when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // If you don't want to use Session Replay, just remove the line below:
  integrations: [replayIntegration()],

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/sveltekit/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

/**
 * After a deploy, an open tab's cached HTML may reference chunk hashes the
 * server no longer has. SvelteKit surfaces that as "error loading dynamically
 * imported module" — the page is broken until the user reloads. Force the
 * reload here instead of asking the user to do it. See Sentry MANKUNKU-8.
 *
 * The reload is gated by a one-shot sessionStorage flag so that if the chunk
 * is still missing after the reload (e.g. user is offline, or a deploy is
 * mid-flight and assets haven't propagated to their CDN edge), the second
 * failure does NOT loop into another reload — it surfaces the error normally.
 */
const STALE_CHUNK_RELOAD_KEY = 'stale-chunk-reload-attempted';

const handleStaleChunkReload: HandleClientError = ({ error }) => {
  const msg = (error as { message?: string } | null)?.message ?? '';
  const isStaleChunkError =
    /error loading dynamically imported module|Failed to fetch dynamically imported module/i.test(
      msg
    );
  if (
    typeof location !== 'undefined' &&
    typeof sessionStorage !== 'undefined' &&
    isStaleChunkError
  ) {
    if (sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) === '1') {
      // Already reloaded once this session and still failing — don't loop.
      sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
      return;
    }
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, '1');
    location.reload();
  }
};

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry(handleStaleChunkReload);
