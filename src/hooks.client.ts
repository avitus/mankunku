import { handleErrorWithSentry, replayIntegration } from "@sentry/sveltekit";
import * as Sentry from '@sentry/sveltekit';
import type { ErrorEvent, EventHint } from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit';
import {
  isStaleChunkErrorMessage,
  shouldDropStaleChunkReport,
  navRecoveryAction,
  shouldAttemptNavRecovery,
  pendingNavTarget
} from '$lib/util/stale-chunk';
import { isEmptyErrorEvent } from '$lib/util/sentry-filters';

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
// handleNavErrorRecovery below; if the recovery doesn't help — or the same tab
// later hits a *different* stale chunk across another deploy — that occurrence
// is the actionable case and is reported. The report/recovery decisions are
// keyed per chunk URL in $lib/util/stale-chunk (unit-tested). See MANKUNKU-8.

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
  // page recovers on the next HMR tick or via handleNavErrorRecovery below.
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
    if (isEmptyErrorEvent(event, hint)) {
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

    // Stale-chunk errors: handleNavErrorRecovery below auto-recovers the first
    // occurrence for a chunk by navigating to the click target. Don't pollute
    // Sentry with that first
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
 * imported module"; a click that races the deploy's server-restart window
 * surfaces a generic fetch failure instead (NetworkError / Load failed /
 * Failed to fetch). Either way the navigation dies and the prior screen stays
 * rendered. Recover by doing a FULL-PAGE load of the URL the user clicked
 * toward (`event.url` is the navigation target in client `handleError`) — a
 * fresh shell + manifest from the server land them where they intended. A
 * `location.reload()` here would re-render the PRIOR page instead, because
 * SvelteKit commits the URL only after loads resolve — the click would appear
 * to do nothing. See Sentry MANKUNKU-8 and MANKUNKU-10.
 *
 * Recovery is gated per failing chunk URL (`navRecoveryAction`) so that if
 * the SAME chunk is still missing after the full-page load (e.g. user is
 * offline, or a deploy is mid-flight and assets haven't propagated), the
 * repeat failure does NOT loop into another navigation — it surfaces
 * normally. A later, DISTINCT stale chunk still gets its own attempt.
 *
 * The same per-chunk record is read by `beforeSend` above so the first
 * occurrence of a STALE-CHUNK error is dropped (the recovery is the fix) and
 * only the recovery-didn't-help case is reported.
 *
 * Two gates protect the recovery from making things worse:
 *
 * - shouldAttemptNavRecovery: `handleError` also fires for failed hover/touch
 *   PRELOADS (data-sveltekit-preload-data) with `event.url` = the preload
 *   target; recovering those would navigate the user to a page they never
 *   clicked. Only failures matching the in-flight navigation recorded by the
 *   root layout's `beforeNavigate` (or a dying initial load) are recovered.
 *
 * - serverReachable: a full-page navigation while the server is down (deploy
 *   restart gap) or the device is offline would eject the user from the
 *   running local-first app onto a browser error page. Probe first; when
 *   unreachable, leave the app in place — the error boundary offers a manual
 *   Reload.
 *
 * Note: this reactive recovery is a backstop. SvelteKit itself full-page
 * navigates to the target when a failed import coincides with a NEW app
 * version (updated.check()), and the proactive `beforeNavigate` guard in
 * +layout.svelte (driven by kit.version.pollInterval) hard-navigates a stale
 * tab before the failing import can happen; this catches whatever slips past
 * (version check unreachable or reporting no change — e.g. dev-server HMR
 * churn, or a click landing inside the deploy's PM2 restart gap).
 */
async function serverReachable(href: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    await fetch(href, { method: 'HEAD', cache: 'no-store' });
    return true; // any HTTP response (even an error status) proves reachability
  } catch {
    return false;
  }
}

const handleNavErrorRecovery: HandleClientError = async ({ error, event }) => {
  const msg = (error as { message?: string } | null)?.message ?? '';
  if (typeof location === 'undefined' || typeof sessionStorage === 'undefined') return;
  const gate = shouldAttemptNavRecovery(
    pendingNavTarget(),
    event?.url?.href ?? null,
    location.href
  );
  if (!gate.proceed) return;
  const action = navRecoveryAction(msg, sessionStorage, gate.targetHref);
  if (action.kind === 'none') return;
  const dest = action.kind === 'navigate' ? action.href : location.href;
  if (!(await serverReachable(dest))) return;
  if (action.kind === 'navigate') {
    location.href = action.href;
  } else {
    location.reload();
  }
};

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry(handleNavErrorRecovery);
