/**
 * How the signed-in user is named in the app chrome. The display name the
 * user set in Settings (`user_profiles.display_name`) wins; the email's local
 * part is only the fallback for an account that never set one.
 */

/** The display name, trimmed, or null when unset or blank. */
function cleanDisplayName(displayName: string | null | undefined): string | null {
	const trimmed = displayName?.trim();
	return trimmed ? trimmed : null;
}

/**
 * First name for the home greeting ("Morning, Andy"): the display name's first
 * word as written, else a best-effort word from the email's local part
 * (digits, dots and common separators stripped, first letter capitalised).
 * Empty when there is nothing to go on.
 */
export function greetingName(
	displayName: string | null | undefined,
	email: string | null | undefined
): string {
	const name = cleanDisplayName(displayName);
	if (name) return name.split(/\s+/)[0];
	if (!email) return '';
	const local = email.split('@')[0];
	const word = local.split(/[._\-+0-9]/).filter(Boolean)[0] ?? local;
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Label for the nav's account menu: the full display name, else the email's
 * local part, else "Account" so the label never renders blank.
 */
export function accountLabel(
	displayName: string | null | undefined,
	email: string | null | undefined
): string {
	return cleanDisplayName(displayName) ?? (email?.split('@')[0].trim() || 'Account');
}
