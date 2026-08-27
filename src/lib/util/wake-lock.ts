// Screen Wake Lock for hands-free practice: without it a session looks idle to
// the OS (mic + audio don't count as display activity) and the screensaver
// interrupts mid-lick. The lock only holds while the tab is visible — the
// browser silently releases it on tab switch, so we re-request on return.

interface WakeLockSentinelLike {
	release(): Promise<void>;
	addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
	request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

let held = false;
let sentinel: WakeLockSentinelLike | null = null;

function wakeLockApi(): WakeLockLike | undefined {
	if (typeof navigator === 'undefined') return undefined;
	return (navigator as { wakeLock?: WakeLockLike }).wakeLock;
}

async function requestLock(): Promise<void> {
	if (!held || sentinel) return;
	const api = wakeLockApi();
	if (!api) return;
	try {
		const s = await api.request('screen');
		if (!held) {
			void s.release().catch(() => {});
			return;
		}
		sentinel = s;
		s.addEventListener('release', () => {
			if (sentinel === s) sentinel = null;
		});
	} catch {
		// Refused (battery saver, permissions policy) — practice works without it.
	}
}

function onVisibilityChange(): void {
	if (document.visibilityState === 'visible') void requestLock();
}

export async function acquireScreenWakeLock(): Promise<void> {
	if (!held) {
		held = true;
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', onVisibilityChange);
		}
	}
	await requestLock();
}

export function releaseScreenWakeLock(): void {
	if (!held) return;
	held = false;
	if (typeof document !== 'undefined') {
		document.removeEventListener('visibilitychange', onVisibilityChange);
	}
	const s = sentinel;
	sentinel = null;
	void s?.release().catch(() => {});
}
