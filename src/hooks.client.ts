import { handleErrorWithSentry, replayIntegration } from "@sentry/sveltekit";
import * as Sentry from '@sentry/sveltekit';
import type { ErrorEvent, EventHint } from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit';
import {
  isStaleChunkErrorMessage,
  shouldDropStaleChunkReport,
  shouldReloadForStaleChunk
} from '$lib/util/stale-chunk';

// `import.meta.env.DEV` is false for `npm run preview`, so a preview running
// on localhost still shipped events with environment='production' (see Sentry
// MANKUNKU-K, captured from http://localhost:4173/auth). Detect localhost by
// hostname too so preview/test sessions land in the right bucket.
function detectEnvironment(): 'development' | 'production' {
  if (import.meta.env.DEV) return 'development';
  if (typeof location !== 'undefined') {
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      return 'development';
    }
  }
  return 'production';
}

const SENTRY_ENVIRONMENT = detectEnvironment();

// After a deploy, an open tab's cached HTML may reference chunk hashes the
// server no longer has. SvelteKit surfaces that as "error loading dynamically
// imported module". The first occurrence for a given chunk is recovered by
// handleStaleChunkReload below; if the reload doesn't help — or the same tab
// later hits a *different* stale chunk across another deploy — that occurrence
// is the actionable case and is reported. The report/reload decisions are keyed
// per chunk URL in $lib/util/stale-chunk (unit-tested). See MANKUNKU-8.

Sentry.init({
  dsn: 'https://a12d5e915778d470c90bf492a29f1bb4@o135479.ingest.us.sentry.io/4511259307081728',

  // Tag events with the actual environment so dev sessions on localhost don't
  // pollute production. The SDK defaults to 'production' when this is unset,
  // which leaks every HMR/compile glitch from `npm run dev` into the prod
  // project (see Sentry MANKUNKU-6/D/1/C/F/7/B/E).
  environment: SENTRY_ENVIRONMENT,

  // In dev, Vite's HMR/dev-server churn produces "error loading dynamically
  // imported module" against localhost:5173 source URLs (e.g. app.css) when a
  // hot update is mid-flight or the dev server restarts. Not actionable — the
  // page recovers on the next HMR tick or via handleStaleChunkReload below.
  // The AbortError pattern fires when an <audio>/<video> src changes while a
  // load is in flight (Firefox is loud about this); not actionable. See
  // Sentry MANKUNKU-8 and MANKUNKU-M.
  ignoreErrors: [
    // Browsers fire AbortError on media elements when the src changes mid-load
    // or the user navigates away. Surfaces as an unhandled rejection in
    // Firefox; harmless. Keep filtering across all environments.
    /The fetching process for the media resource was aborted/i,
    /AbortError: .*aborted by the user agent/i,
    ...(SENTRY_ENVIRONMENT === 'development'
      ? [
          /error loading dynamically imported module/i,
          /Failed to fetch dynamically imported module/i
        ]
      : [])
  ],

  // Drop events whose error has no message and no stacktrace — they read as
  // "<unknown>" / "undefined" in the UI and aren't actionable. See Sentry
  // MANKUNKU-K.
  beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
    const ex = event.exception?.values?.[0];
    const hasMessage =
      typeof event.message === 'string' && event.message.trim().length > 0;
    const hasExceptionValue =
      typeof ex?.value === 'string' && ex.value.trim().length > 0;
    const hasFrames = (ex?.stacktrace?.frames?.length ?? 0) > 0;
    if (!hasMessage && !hasExceptionValue && !hasFrames && hint?.originalException == null) {
      return null;
    }

    // Drop errors thrown from Vite/Svelte HMR machinery in dev — they surface
    // mid-save when a module is being re-evaluated and a dependent runs an
    // effect against a momentarily-stale scope (a binding that's not defined
    // yet, or an export that's transiently undefined). The page recovers on
    // the next HMR tick. Two sources:
    //   - `@vite/client`: Vite's own HMR client (see MANKUNKU-P).
    //   - `hmr/wrapper`: Svelte's HMR effect re-runner. Surfaces as transient
    //     "X is not defined" ReferenceErrors on localhost:5173 while editing a
    //     component, where X is a variable/component that was just refactored
    //     or removed. See MANKUNKU-Q/S/T/V.
    if (SENTRY_ENVIRONMENT === 'development') {
      const frames = ex?.stacktrace?.frames ?? [];
      if (
        frames.some(
          (f) =>
            (typeof f.filename === 'string' && f.filename.includes('@vite/client')) ||
            (typeof f.function === 'string' && f.function.includes('hmr/wrapper'))
        )
      ) {
        return null;
      }
    }

    // Stale-chunk errors: handleStaleChunkReload below auto-recovers the first
    // occurrence for a chunk by reloading. Don't pollute Sentry with that first
    // occurrence — but DO report once a reload for that same chunk was already
    // attempted, because it means the reload didn't help and the error is
    // actionable. See MANKUNKU-8.
    const exMessage = typeof ex?.value === 'string' ? ex.value : '';
    const messageStr = typeof event.message === 'string' ? event.message : '';
    const staleMessage = [exMessage, messageStr].find(isStaleChunkErrorMessage);
    if (
      staleMessage &&
      typeof sessionStorage !== 'undefined' &&
      shouldDropStaleChunkReport(staleMessage, sessionStorage)
    ) {
      return null;
    }

    return event;
  },

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
 * The reload is gated per failing chunk URL (`shouldReloadForStaleChunk`) so
 * that if the SAME chunk is still missing after the reload (e.g. user is
 * offline, or a deploy is mid-flight and assets haven't propagated), the repeat
 * failure does NOT loop into another reload — it surfaces normally. A later,
 * DISTINCT stale chunk still gets its own reload attempt.
 *
 * The same per-chunk record is read by `beforeSend` above so the first
 * occurrence for a chunk is dropped (the reload is the fix) and only the
 * reload-didn't-help case is reported.
 *
 * Note: this reactive reload is a backstop. The proactive `beforeNavigate`
 * guard in +layout.svelte (driven by kit.version.pollInterval) reloads a stale
 * tab before the failing import can happen; this catches whatever slips past.
 */
const handleStaleChunkReload: HandleClientError = ({ error }) => {
  const msg = (error as { message?: string } | null)?.message ?? '';
  if (
    typeof location !== 'undefined' &&
    typeof sessionStorage !== 'undefined' &&
    shouldReloadForStaleChunk(msg, sessionStorage)
  ) {
    location.reload();
  }
};

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry(handleStaleChunkReload);
