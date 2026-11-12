import { BACKING_STYLES } from '$lib/audio/backing-styles';

/**
 * Captured musicality 0.1–0.16 regressions used Ballad swing 0.55. Main changed
 * its default to 0.53 (5f972203). Retain the historical input, not new hashes:
 * these suites check the archived events, decisions and checkpoint identities.
 * Current app release contracts in backing-arrangement.test use live styles.
 * This copy never mutates the application registry.
 */
export const HISTORICAL_MUSICALITY_STYLES = {
 ...BACKING_STYLES,
 ballad: { ...BACKING_STYLES.ballad, defaultSwing: 0.55 }
};
