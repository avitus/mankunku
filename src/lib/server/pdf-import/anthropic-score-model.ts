import { PDF_IMPORT_SYSTEM_MODEL } from '$app/env/private';
import { ANTHROPIC_TUNE_MODEL } from '$lib/server/anthropic';

/** Retain the earlier reader for controlled comparisons on the same printed part. */
export function anthropicSystemModel(): string {
	return PDF_IMPORT_SYSTEM_MODEL === 'claude-fable-5' ? PDF_IMPORT_SYSTEM_MODEL : ANTHROPIC_TUNE_MODEL;
}
