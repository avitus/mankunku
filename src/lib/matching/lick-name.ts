/** Suggested title guidance; custom names remain unrestricted. */
export const LICK_NAME_TEMPLATE = 'Artist - Song Name';

/** Number a suggested title only when it already exists in the user's book. */
export function availableLickName(base: string, existingNames: string[]): string {
	const names = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase()));
	if (!names.has(base.toLocaleLowerCase())) return base;
	let number = 2;
	while (names.has(`${base} ${number}`.toLocaleLowerCase())) number++;
	return `${base} ${number}`;
}
