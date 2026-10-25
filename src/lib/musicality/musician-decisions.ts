/** Compact, literal explanations of generated decisions; never an imagined musician monologue. */
import type { GeneratedBacking } from '$lib/audio/backing-generation';
import type { BackingStyle } from '$lib/types/instruments';
import type { EnsembleRole } from '$lib/audio/ensemble-plan';

export interface MusicianDecisionCard {
	instrument: 'bass' | 'piano' | 'drums';
	title: string;
	role: string;
	action: string;
	detail: string;
	eventCount: number;
	/** Inspectable score evidence, separate from the short musical description. */
	evidence: string[];
}
export interface MusicianDecisionContext {
	barIndex: number;
	ppq: number;
	beatsPerBar: number;
	style: BackingStyle;
	orchestration: 'original' | 'coordinated';
}
const roles: Record<EnsembleRole, string> = {
	time: 'Keep time', support: 'Support', lead: 'Lead the phrase', respond: 'Response assigned',
	leave_space: 'Leave space', mark_form: 'Mark the form'
};
const plain = (code: string) => code.replaceAll('_', ' ').replaceAll('-', ' ');
const countText = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
const noteName = (midi: number) => `${['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** Read the committed score for one sounding bar, counting actual jittered onset ticks. */
export function describeMusicianDecisions(generated: GeneratedBacking, context: MusicianDecisionContext): MusicianDecisionCard[] {
	const { barIndex, ppq, beatsPerBar, style } = context;
	const firstTick = barIndex * beatsPerBar * ppq;
	const inBar = (event: { time: string }) => {
		const tick = Number.parseInt(event.time, 10);
		return tick >= firstTick && tick < firstTick + beatsPerBar * ppq;
	};
	const bass = generated.bassEvents.filter(inBar);
	const piano = generated.compEvents.filter(inBar);
	const drums = generated.drumEvents.filter(inBar);
	const plan = context.orchestration === 'coordinated' ? generated.ensemblePlan?.bars.find((b) => b.barIndex === barIndex) : undefined;
	const development = context.orchestration === 'coordinated' ? generated.ensembleDevelopment : undefined;
	const role = (instrument: 'bass' | 'piano' | 'drums') => plan ? roles[plan[instrument].role] : 'Original pattern';
	const sharedEvidence = (instrument: 'bass' | 'piano' | 'drums'): string[] => {
		if (!plan) return [];
		const evidence = [`Phrase intent: ${plain(plan.phraseIntent)}`];
		if (plan.responseOwner === instrument) evidence.push('Assigned the response');
		if (plan.coordinatedAccent?.participants.includes(instrument)) evidence.push('Planned shared arrival on this downbeat');
		if (plan.setupFor?.participants.includes(instrument)) evidence.push(`Setup reserved for bar ${plan.setupFor.targetBarIndex + 1}`);
		return evidence;
	};
	const turnaround = development?.bassTurnarounds.find((t) => t.startBar <= barIndex && barIndex < t.arrivalBar);
	const walking = style === 'swing' || style === 'straight';
	const bassCard: MusicianDecisionCard = {
		instrument: 'bass', title: 'Bass', role: role('bass'), eventCount: bass.length,
		action: bass.length ? (walking ? 'Carry the bass line' : 'Hold the bass pulse') : 'No new bass attack',
		detail: walking ? 'The line connects the harmony through the bar.'
			: style === 'bossa-nova' ? 'The bossa bass pattern anchors the groove.' : 'A spacious bass pulse supports the ballad.',
		evidence: [countText(bass.length, 'note attack'), ...sharedEvidence('bass')]
	};
	if (!bass.length) bassCard.detail = 'Earlier bass notes may still sustain through this bar.';
	if (bass.length) bassCard.evidence.push(`Notes: ${bass.map((e) => noteName(e.midi)).join(' · ')}`);
	if (turnaround?.status === 'planned') {
		const heardTurnaround = bass.some((event) => turnaround.notes.some((note) => note.absBeat === event.absBeat && note.midi === event.midi));
		if (heardTurnaround) {
			bassCard.action = 'Walk into the next chorus';
			bassCard.detail = `${turnaround.direction === 'ascending' ? 'An ascending' : 'A descending'} line approaches the arrival in bar ${turnaround.arrivalBar + 1}.`;
		}
		bassCard.evidence.push(`Turnaround planned into bar ${turnaround.arrivalBar + 1}`);
		if (turnaround.targetMidi !== null) bassCard.evidence.push(`Arrival target: ${noteName(turnaround.targetMidi)}`);
	} else if (turnaround) bassCard.evidence.push(`Turnaround omitted: ${plain(turnaround.reason)}`);
	const motif = development?.pianoMotifs.find((m) => m.barIndex === barIndex);
	const pianoCard: MusicianDecisionCard = {
		instrument: 'piano', title: 'Piano', role: role('piano'), eventCount: piano.length,
		action: piano.length ? 'Support the harmony' : 'No new chord attack',
		detail: piano.length ? 'Comping supports the changes in this bar.' : 'Earlier chords may still sustain through this bar.',
		evidence: [countText(piano.length, 'chord attack'), ...sharedEvidence('piano')]
	};
	for (const [index, event] of piano.entries()) pianoCard.evidence.push(`Chord ${index + 1}: ${event.notes.map(noteName).join(' · ')}`);
	if (motif) {
		if (piano.some((event) => Math.floor(event.absBeat / beatsPerBar) === barIndex) && motif.motifId) {
			pianoCard.action = ({ statement: 'Introduce a comping idea', repeat: 'Repeat the comping idea', displace: 'Shift the comping idea',
				shorten: 'Shorten the comping idea', space: 'Leave space', fallback: 'Support the harmony' })[motif.transform];
			pianoCard.detail = `The phrase uses ${plain(motif.sourceFigureId ?? motif.motifId)}.`;
			pianoCard.evidence.push(`Motif: ${motif.motifId}`, `Development: ${plain(motif.transform)}`);
		} else if (motif.reason === 'native_pattern') {
			pianoCard.detail = style === 'bossa-nova' ? 'The native bossa comping pattern keeps its rhythmic character.' : 'The native ballad voicing pattern keeps its spacious pacing.';
		}
		if (motif.reason) pianoCard.evidence.push(`Comping decision: ${plain(motif.reason)}`);
	}
	if (plan?.piano.silenceReason) pianoCard.evidence.push(`Space reserved: ${plain(plan.piano.silenceReason)}`);
	const drumPhrase = development?.drumPhrases.find((d) => d.barIndex === barIndex);
	const drumCard: MusicianDecisionCard = {
		instrument: 'drums', title: 'Drums', role: role('drums'), eventCount: drums.length,
		action: drums.length ? 'Keep the groove' : 'No new drum hit',
		detail: style === 'bossa-nova' ? 'The bossa timekeeping pattern retains its native pulse.'
			: style === 'ballad' ? 'The ballad keeps a spacious cymbal pulse.'
			: style === 'straight' ? 'The kit keeps the straight-eighth pulse.' : 'The kit carries the swing pulse.',
		evidence: [countText(drums.length, 'kit hit'), ...sharedEvidence('drums')]
	};
	if (drumPhrase) {
		const hasCommentary = drums.some((event) => event.role === 'commentary' && Math.floor(event.absBeat / beatsPerBar) === barIndex);
		if (hasCommentary && drumPhrase.commentary.source === 'piano' && drumPhrase.commentary.hits.length) {
			drumCard.action = 'Answer the piano';
			if (drumPhrase.commentary.sourceBar !== null) drumCard.evidence.push(`Piano rhythm from bar ${drumPhrase.commentary.sourceBar + 1}`);
		} else if (hasCommentary && drumPhrase.commentary.hits.length) {
			drumCard.action = drumPhrase.commentary.transform === 'setup' ? 'Set up the next arrival' : 'Add a short drum phrase';
		}
		if (drumPhrase.ride.mode !== 'none') drumCard.evidence.push(`Ride pattern: ${plain(drumPhrase.ride.mode)}`);
		if (drumPhrase.commentary.motifId) drumCard.evidence.push(`Commentary: ${plain(drumPhrase.commentary.transform)}`);
		if (drumPhrase.commentary.reason) drumCard.evidence.push(`Commentary decision: ${plain(drumPhrase.commentary.reason)}`);
	}
	if (plan?.drums.silenceReason) drumCard.evidence.push(`Commentary space: ${plain(plan.drums.silenceReason)}`);
	return [bassCard, pianoCard, drumCard];
}
