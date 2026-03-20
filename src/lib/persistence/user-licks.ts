/**
 * CRUD for user-recorded licks in localStorage.
 */

import type { Phrase } from '$lib/types/music.ts';
import { save, load } from './storage.ts';

const STORAGE_KEY = 'user-licks';

/** Generate a unique ID for a user lick */
function generateId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let rand = '';
	for (let i = 0; i < 4; i++) {
		rand += chars[Math.floor(Math.random() * chars.length)];
	}
	return `user-${Date.now()}-${rand}`;
}

/** Get all user-recorded licks */
export function getUserLicks(): Phrase[] {
	return load<Phrase[]>(STORAGE_KEY) ?? [];
}

/** Save a new user lick (assigns ID and source) */
export function saveUserLick(lick: Phrase): void {
	const licks = getUserLicks();
	const toSave: Phrase = {
		...lick,
		id: lick.id || generateId(),
		source: 'user-recorded',
		category: 'user'
	};
	licks.push(toSave);
	save(STORAGE_KEY, licks);
}

/** Delete a user lick by ID */
export function deleteUserLick(id: string): void {
	const licks = getUserLicks().filter((l) => l.id !== id);
	save(STORAGE_KEY, licks);
}
