import { load, save } from '$lib/persistence/storage';
import { normalizeChoruses } from '$lib/state/tune-practice-plan';

// Keep the existing per-user practice preference, now shared by both tune pages.
const STORAGE_KEY = 'tune-practice-choruses';
export function savedSoloChoruses(): number {
	const value = load<unknown>(STORAGE_KEY);
	return normalizeChoruses(typeof value === 'number' ? value : 1);
}
export function saveSoloChoruses(value: number): number {
	const count = normalizeChoruses(value);
	save(STORAGE_KEY, count);
	return count;
}
