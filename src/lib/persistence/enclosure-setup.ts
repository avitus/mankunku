import type { LickPracticeConfig } from '$lib/types/lick-practice';
import { enclosuresTrick } from '$lib/tricks/devices/enclosures';
import { resolveEnclosurePracticeBed } from '$lib/tricks/enclosure-practice';
import { load, save } from './storage';

type EnclosureSetup = Pick<LickPracticeConfig,
	'trickParameters' | 'trickProgressionType' | 'backingStyle' | 'practiceMode'>;

/** Device-local setup preferences, isolated by the storage layer's active user. */
export function loadEnclosureSetup(): EnclosureSetup | null {
	const stored = load<EnclosureSetup>('enclosure-setup');
	if (!stored || typeof stored !== 'object' || !stored.trickParameters) return null;
	const parameters = stored.trickParameters;
	if (!enclosuresTrick.parameters.every(def => def.values.includes(parameters[def.name]))) return null;
	if (!['swing', 'bossa-nova', 'ballad', 'straight'].includes(stored.backingStyle)) return null;
	if (!['continuous', 'call-response'].includes(stored.practiceMode)) return null;
	return {
		trickParameters: { ...parameters },
		trickProgressionType: resolveEnclosurePracticeBed(parameters, stored.trickProgressionType),
		backingStyle: stored.backingStyle,
		practiceMode: stored.practiceMode
	};
}

export function saveEnclosureSetup(config: LickPracticeConfig): void {
	const enclosure = config.sessionType === 'trick' && config.trickId === 'enclosures';
	save('enclosure-setup-active', enclosure);
	if (!enclosure || !config.trickParameters) return;
	save<EnclosureSetup>('enclosure-setup', {
		trickParameters: config.trickParameters,
		trickProgressionType: config.trickProgressionType,
		backingStyle: config.backingStyle,
		practiceMode: config.practiceMode
	});
}

export function wasEnclosureSetupActive(): boolean {
	return load('enclosure-setup-active') === true;
}
