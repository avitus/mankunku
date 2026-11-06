/**
 * Share of page loads (browser) and requests (server) that Sentry traces.
 *
 * Both sides traced every one (1.0) until 2026-11-05. The Sentry organisation's
 * span quota is shared by every project in it, and it ran out on 2026-10-24;
 * from then on ingest refused every trace (`span_usage_exceeded`). Errors and
 * replays are sampled separately and are unaffected by this rate.
 */
export const TRACES_SAMPLE_RATE = 0.1;
