import type { SpeakerCheck } from './speaker-checks';

const results = new Set([
	'saved', 'unsaved', 'rejected', 'silent-output', 'unavailable', 'unsupported-input',
	'disabled', 'saved-rejection', 'no-matching-profile', 'device-or-clock-changed', 'invalid-filter',
	'expired', 'short-cue', 'insufficient-time', 'insufficient-samples', 'deadline',
	'timing', 'reduction', 'level', 'attacks', 'active', 'measurement-error',
	'timeout', 'interrupted', 'processor-error', 'worker-error', 'diagnostic-probe'
]);
const errors: ReadonlyMap<string, string> = new Map([
	['Room measurement timed out', 'timeout'], ['Room measurement interrupted', 'interrupted'],
	['Room capture processor failed', 'processor-error'], ['Room estimation failed', 'worker-error'],
	['Room estimation worker failed', 'worker-error']
]);
const measurements = [
	'rate', 'cueNumber', 'attempt', 'listenSeconds', 'captureSeconds', 'startSeconds',
	'calibratedDelaySamples', 'calibrationReductionDb', 'offset', 'broadbandOffset', 'gain',
	'validationGain', 'reduction', 'transientReduction', 'micRms', 'predictedRms', 'sessionCues', 'closingStartSeconds',
	'initialReduction', 'initialTransientReduction', 'initialValidationGain', 'graphLeadSeconds', 'learnedCuesAtStart',
	'retryOffsetDeltaSamples', 'retryReduction', 'retryTransientReduction', 'retryValidationGain'
] as const;
const surfaces = new Set(['ear-training', 'lick-practice', 'settings']);
const stages = new Set(['sound-check', 'listen', 'practice']);
const methods = new Set(['saved', 'calibrated-gain', 'cue', 'session']);
const retryStages = new Set(['insufficient-samples', 'ending', 'alignment', 'correction-power', 'opening', 'verified']);
const failures = new Set(['timing', 'reduction', 'level', 'attacks']);

type SpeakerMetrics = Partial<Record<typeof measurements[number], number>> & {
	session: string;
	surface: string;
	stage: string;
	result: string;
	clientVersion?: string;
	method?: string;
	initialFailure?: string;
	retryStage?: string;
	retryFailure?: string;
};

/** The wire format is also the log allowlist. Local recordings and arbitrary strings stay on the device. */
export function speakerMetrics(value: unknown): SpeakerMetrics | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as Record<string, unknown>;
	if (typeof row.surface !== 'string' || !surfaces.has(row.surface) ||
		typeof row.stage !== 'string' || !stages.has(row.stage) ||
		typeof row.result !== 'string' || !results.has(row.result) ||
		typeof row.session !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(row.session)) return null;
	const fields: Record<string, number> = {};
	for (const key of measurements) {
		const n = row[key];
		if (typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e8) fields[key] = n;
	}
	return {
		session: row.session, surface: row.surface, stage: row.stage, result: row.result,
		...(typeof row.clientVersion === 'string' && /^[\da-f]{7,40}$/i.test(row.clientVersion) && {clientVersion: row.clientVersion}),
		...(typeof row.method === 'string' && methods.has(row.method) && {method: row.method}),
		...(typeof row.initialFailure === 'string' && failures.has(row.initialFailure) && {initialFailure: row.initialFailure}),
		...(typeof row.retryStage === 'string' && retryStages.has(row.retryStage) && {retryStage: row.retryStage}),
		...(typeof row.retryFailure === 'string' && failures.has(row.retryFailure) && {retryFailure: row.retryFailure}),
		...fields
	};
}

export function summarizeSpeakerCheck(event: SpeakerCheck, session: string, surface: string, clientVersion: string): SpeakerMetrics | null {
	const check = event.check;
	return speakerMetrics({
		...event, ...check, session, surface, clientVersion,
		result: results.has(event.result) ? event.result : errors.get(event.result) ?? 'measurement-error',
		method: check?.accepted ? (check.calibratedGain ? 'calibrated-gain' : check.sessionCues ? 'session' : check.initial ? 'cue' : 'saved') : undefined,
		retryFailure: check?.retryWindow?.failure, retryReduction: check?.retryWindow?.reduction,
		retryTransientReduction: check?.retryWindow?.transientReduction, retryValidationGain: check?.retryWindow?.validationGain,
		initialFailure: check?.initial?.failure, initialReduction: check?.initial?.reduction,
		initialTransientReduction: check?.initial?.transientReduction, initialValidationGain: check?.initial?.validationGain
	});
}
