/** Quality and alignment policy is separate from the OMR format converter. */
import { omrSystemResponses, type OmrNormalized } from './omr-transcription';
import { barTilingIssues, type BarMelody } from './system-bar-validation';

export function selectOmrSystems(
	omr: OmrNormalized,
	barCounts: number[],
	meter: [number, number]
): ReturnType<typeof omrSystemResponses> {
	if (omr.qualityWarnings?.length)
		return {
			responses: barCounts.map(() => null),
			warnings: [
				`OMR decoder reported ${[...new Set(omr.qualityWarnings)].join(', ')}; all lines require independent recognition.`
			]
		};
	const total = barCounts.reduce((n, c) => n + c, 0);
	if (omr.measures.length !== total) {
		return {
			responses: barCounts.map(() => null),
			warnings: [
				`OMR has ${omr.measures.length} measures; layout has ${total}. Alignment is unknown, so all lines use the standard reader.`
			]
		};
	}
	const result = omrSystemResponses(omr, barCounts, meter);
	const repeated = new Set<number>();
	let runStart = 0;
	const fingerprints = omr.measures.map((m) => JSON.stringify(m.notes));
	for (let i = 1; i <= fingerprints.length; i++) {
		if (i < fingerprints.length && fingerprints[i] === fingerprints[runStart]) continue;
		if (i - runStart >= 8) for (let j = runStart; j < i; j++) repeated.add(j);
		runStart = i;
	}
	let cursor = 0;
	for (const [index, count] of barCounts.entries()) {
		const chunk = omr.measures.slice(cursor, cursor + count);
		const response = result.responses[index];
		const issues: string[] = [];
		chunk.forEach((m, i) => {
			if (
				m.raw_unparsed?.length ||
				m.warnings?.some((w) => /UNPARSEABLE|TRUNCAT|MULTI_VOICE/.test(w.code))
			) {
				issues.push(`bar ${i + 1}: unreadable or ambiguous OMR content`);
			}
			const melody: BarMelody = m.notes.map((n) => [
				(n.onset[0] / n.onset[1]) * meter[1],
				(n.duration[0] / n.duration[1]) * meter[1],
				n.is_rest ? 'rest' : (n.spelled_pitch ?? '')
			]);
			const end = Math.max(0, ...melody.map(([b, d]) => b + d));
			const pickup = cursor + i === 0 && total > 1 && end > 0 && end < meter[0];
			const first = omr.measures[0].notes;
			const firstEnd = Math.max(
				0,
				...first.map((n) => (n.onset[0] / n.onset[1] + n.duration[0] / n.duration[1]) * meter[1])
			);
			const complement =
				cursor + i === total - 1 &&
				total > 1 &&
				firstEnd > 0 &&
				firstEnd < meter[0] &&
				Math.abs(firstEnd + end - meter[0]) < 1e-6;
			issues.push(...barTilingIssues(melody, i, pickup || complement ? end : meter[0]));
			if (melody.some((n) => !/^(?:rest|[A-G][#b]{0,2}-?\d)$/.test(n[2])))
				issues.push(`bar ${i + 1}: invalid OMR pitch`);
		});
		if (chunk.some((_, i) => repeated.has(cursor + i)))
			issues.push('repeated OMR output needs independent verification');
		if (response && issues.length) {
			result.responses[index] = null;
			result.warnings.push(`line ${index + 1}: OMR rejected — ${[...new Set(issues)].join('; ')}`);
		}
		cursor += count;
	}
	return result;
}
