/** Compact, literal explanations of generated decisions; never an imagined musician monologue. */
import type { GeneratedBacking } from '$lib/audio/backing-generation';
import type { BackingStyle } from '$lib/types/instruments';
import { PITCH_CLASSES } from '$lib/types/music';
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

/** Validate the performed reply before using it as the source of another explanation. */
function matchesAcceptedPianoAnswer(generated: GeneratedBacking, context: MusicianDecisionContext, barIndex: number): boolean {
	if (context.orchestration !== 'coordinated') return false;
	const { beatsPerBar, ppq, style } = context;
	const firstTick = barIndex * beatsPerBar * ppq;
	const inBar = (event: { time: string }) => Number.parseInt(event.time, 10) >= firstTick && Number.parseInt(event.time, 10) < firstTick + beatsPerBar * ppq;
	const piano = generated.compEvents.filter(inBar);
	const development = generated.ensembleDevelopment;
	const plan = generated.ensemblePlan?.bars.find(entry => entry.barIndex === barIndex);
	const motif = development?.pianoMotifs.find(entry => entry.barIndex === barIndex);
	const walking = style === 'swing' || style === 'straight';
	const answer = development?.pianoAnswers?.find(entry => entry.barIndex === barIndex);
	const answerSource = answer?.source;
	const sourcePhrase = development?.drumPhrases.find(entry => entry.barIndex === answerSource?.barIndex);
	const answeringDrums = development?.drumPhrases.find(entry => entry.barIndex === barIndex);
	return walking && plan?.performanceEnergy?.phase === 'solo_build' && answer?.version === 1 && answer.drumCommentary === 'space' &&
		answerSource?.barIndex === barIndex - 1 && ['statement', 'repeat', 'displace', 'orchestrate', 'fallback'].includes(answerSource.transform) &&
		answerSource.hits.length >= 2 && answerSource.hits.length <= 3 && new Set(answerSource.hits.map(hit => hit.absBeat)).size >= 2 &&
		sourcePhrase?.commentary.source === 'vocabulary' && sourcePhrase.commentary.transform === answerSource.transform &&
		answerSource.hits.every(hit => hit.role === 'commentary' && ['snare', 'crossstick', 'kick'].includes(hit.drum) &&
			Math.floor(hit.absBeat / beatsPerBar) === answerSource.barIndex && Number.parseInt(hit.time, 10) >= firstTick - beatsPerBar * ppq && Number.parseInt(hit.time, 10) < firstTick &&
			generated.drumEvents.some(event => event.time === hit.time && event.absBeat === hit.absBeat && event.drum === hit.drum && event.velocity === hit.velocity && event.role === hit.role) &&
			[sourcePhrase.commentary.hits, sourcePhrase.hits].every(hits => hits.some(event => event.role === 'commentary' && event.drum === hit.drum && event.velocity === hit.velocity && event.beatOffset === hit.absBeat - answerSource.barIndex * beatsPerBar))) &&
		piano.length === 1 && answer.replyOffset >= 0 && answer.replyOffset < beatsPerBar && answer.attack.absBeat === barIndex * beatsPerBar + answer.replyOffset &&
		piano[0].time === answer.attack.time && piano[0].absBeat === answer.attack.absBeat && piano[0].duration === answer.attack.duration && piano[0].velocity === answer.attack.velocity &&
		piano[0].notes.length === answer.attack.notes.length && piano[0].notes.every((note, index) => note === answer.attack.notes[index]) &&
		generated.compEvents.filter(event => Math.floor(event.absBeat / beatsPerBar) === barIndex).length === 1 &&
		motif?.reason === 'drum_reply' && motif.transform === 'fallback' && motif.motifId === null && motif.sourceFigureId === null && motif.hits.length === 1 && motif.hits[0].b === answer.replyOffset &&
		answeringDrums?.commentary.transform === 'space' && !answeringDrums.commentary.hits.length && !answeringDrums.hits.some(hit => hit.role === 'commentary') &&
		!generated.drumEvents.some(event => event.role === 'commentary' && (inBar(event) || Math.floor(event.absBeat / beatsPerBar) === barIndex));
}

/** A native reply is evidence only when both accepted musical turns are still present. */
function matchesNativeBalladReply(generated: GeneratedBacking, context: MusicianDecisionContext): boolean {
 if (context.orchestration !== 'coordinated' || context.style !== 'ballad') return false;
 const { barIndex, beatsPerBar, ppq } = context;
 const firstTick = barIndex * beatsPerBar * ppq;
 const inBar = (event: { time: string }) => Number.parseInt(event.time, 10) >= firstTick && Number.parseInt(event.time, 10) < firstTick + beatsPerBar * ppq;
 const development = generated.ensembleDevelopment;
 const reply = development?.nativeBalladReplies?.find(entry => entry.barIndex === barIndex);
 if (reply?.version !== 1 || reply.profile !== 'ballad-late-pad-v1' || reply.drumCommentary !== 'space' || reply.source.barIndex !== barIndex - 1) return false;
 const source = reply.source.hit;
 const sourcePlan = generated.ensemblePlan?.bars.find(entry => entry.barIndex === reply.source.barIndex);
 const plan = generated.ensemblePlan?.bars.find(entry => entry.barIndex === barIndex);
 const sourceTrace = development?.drumPhrases.find(entry => entry.barIndex === reply.source.barIndex);
 const drums = development?.drumPhrases.find(entry => entry.barIndex === barIndex);
 const motif = development?.pianoMotifs.find(entry => entry.barIndex === barIndex);
 const piano = generated.compEvents.filter(inBar);
 const sourceOffset = source.absBeat - reply.source.barIndex * beatsPerBar;
 const sourceTick = Number.parseInt(source.time, 10);
 const sameHit = (hit: { drum: string; beatOffset: number; velocity: number; role?: string }) => hit.drum === source.drum && hit.beatOffset === sourceOffset && hit.velocity === source.velocity && hit.role === 'commentary';
 return beatsPerBar === 4 && plan?.performanceEnergy?.phase === 'solo_build' && !!sourcePlan?.performanceEnergy &&
  sourcePlan.performanceEnergy.chorusIndex === plan.performanceEnergy.chorusIndex && sourcePlan.phraseStartBar === plan.phraseStartBar &&
  sourceTrace?.style === 'ballad' && sourceTrace.commentary.source === 'vocabulary' && sourceTrace.commentary.sourceId === 'ballad-color' &&
  sourceTrace.commentary.transform === 'fallback' && sourceTrace.commentary.hits.length === 1 && sameHit(sourceTrace.commentary.hits[0]) && sourceTrace.hits.some(sameHit) &&
  source.role === 'commentary' && ['snare', 'crossstick'].includes(source.drum) && [2.5, 3].includes(sourceOffset) &&
  sourceTick >= firstTick - beatsPerBar * ppq && sourceTick < firstTick &&
  generated.drumEvents.filter(event => event.role === 'commentary' && (Math.floor(event.absBeat / beatsPerBar) === reply.source.barIndex ||
   (Number.parseInt(event.time, 10) >= firstTick - beatsPerBar * ppq && Number.parseInt(event.time, 10) < firstTick))).length === 1 &&
  generated.drumEvents.some(event => event.time === source.time && event.absBeat === source.absBeat && event.drum === source.drum && event.velocity === source.velocity && event.role === source.role) &&
  piano.length === 1 && generated.compEvents.filter(event => Math.floor(event.absBeat / beatsPerBar) === barIndex).length === 1 &&
  reply.attack.absBeat === barIndex * beatsPerBar + 2 && piano[0].time === reply.attack.time && piano[0].absBeat === reply.attack.absBeat &&
  piano[0].duration === reply.attack.duration && reply.attack.duration > 0 && piano[0].velocity === reply.attack.velocity &&
  piano[0].notes.length > 0 && piano[0].notes.length === reply.attack.notes.length && piano[0].notes.every((note, index) => note === reply.attack.notes[index]) &&
  motif?.reason === 'native_drum_reply' && motif.transform === 'fallback' && motif.motifId === null && motif.sourceFigureId === null &&
  motif.hits.length === 1 && motif.hits[0].b === 2 && motif.hits[0].d === 1.8 &&
  drums?.style === 'ballad' && drums.commentary.transform === 'space' && !drums.commentary.hits.length && !drums.hits.some(hit => hit.role === 'commentary') &&
  !generated.drumEvents.some(event => event.role === 'commentary' && (inBar(event) || Math.floor(event.absBeat / beatsPerBar) === barIndex));
}

/** Planned performance direction for the sounding bar; absent for original/legacy takes. */
export function describePerformanceArc(generated: GeneratedBacking, context: MusicianDecisionContext): { phase: string; label: string; targetEnergy: number } | null {
	if (context.orchestration !== 'coordinated') return null;
	const arc = generated.ensemblePlan?.bars.find((bar) => bar.barIndex === context.barIndex)?.performanceEnergy;
	if (!arc) return null;
	const labels = {
		head_in: 'Head in · Leave room for the melody', solo_build: 'Solo · Build the accompaniment',
		solo_peak: 'Solo · Sustain the planned peak', solo_release: 'Solo · Ease back',
		head_return: 'Head return · Return to the melody', ending: 'Ending · Release the energy'
	};
	return { phase: arc.phase, label: labels[arc.phase], targetEnergy: arc.targetEnergy };
}

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
	const arc = describePerformanceArc(generated, context);
	const role = (instrument: 'bass' | 'piano' | 'drums') => plan ? roles[plan[instrument].role] : 'Original pattern';
	const sharedEvidence = (instrument: 'bass' | 'piano' | 'drums'): string[] => {
		if (!plan) return [];
		const evidence = [`Phrase intent: ${plain(plan.phraseIntent)}`];
		if (arc) evidence.push(`Planned performance arc: ${arc.label}`, `Nominal arc target: ${arc.targetEnergy.toFixed(2)} / 1; style-adjusted bar plan: ${plan.energy.toFixed(2)} / 1`);
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
	const bassFeel = development?.bassFeel?.find((entry) => entry.barIndex === barIndex);
	if (bassFeel) {
		bassCard.evidence.push(`Planned bass feel: ${bassFeel.feel} · ${plain(bassFeel.reason)}`);
		if (bass.length && walking) {
			bassCard.action = bassFeel.feel === 'two' ? 'Support in two' : 'Walk through the changes';
			bassCard.detail = bassFeel.feel === 'two'
				? 'A two-feel supports the melody; harmonic changes can add attacks.'
				: 'Walking quarter notes carry the harmony forward.';
		}
	}
	if (bass.length) bassCard.evidence.push(`Notes: ${bass.map((e) => noteName(e.midi)).join(' · ')}`);
	const delayedRoot = development?.bassDelayedRoots?.find(entry => entry.barIndex === barIndex);
	if (delayedRoot && delayedRoot.notes.length === 2) {
		const [entrance, landing] = delayedRoot.notes;
		const degree = ((entrance.midi - delayedRoot.rootPc) % 12 + 12) % 12;
		if (entrance.absBeat === barIndex * beatsPerBar && [1, 2].includes(landing.absBeat - entrance.absBeat) &&
			landing.midi % 12 === delayedRoot.rootPc &&
			(delayedRoot.degree === 'third' ? [3, 4].includes(degree) : [6, 7, 8].includes(degree)) &&
			delayedRoot.notes.every(note => bass.some(event => event.time === note.time && event.absBeat === note.absBeat && event.midi === note.midi)) &&
			!bass.some(event => event.absBeat > entrance.absBeat && event.absBeat < landing.absBeat && event.midi % 12 === delayedRoot.rootPc)) {
			bassCard.action = 'Let the root arrive later';
			bassCard.detail = `Start on the ${delayedRoot.degree}, then settle on the root without changing the native pulse.`;
			bassCard.evidence.push(`Delayed root: ${noteName(entrance.midi)} → ${noteName(landing.midi)} on beat ${landing.absBeat - entrance.absBeat + 1}`);
		}
	}
	if (walking) for (const continuation of development?.bassContinuations ?? []) {
		const notes = continuation.notes;
		const boundary = continuation.boundaryAbsBeat;
		const target = generated.ensemblePlan?.bars.find(entry => entry.barIndex === continuation.barIndex);
		const direction = continuation.direction === 'up' ? 1 : continuation.direction === 'down' ? -1 : 0;
		if (!target?.performanceEnergy || !direction || notes.length !== 3 ||
			boundary !== continuation.barIndex * beatsPerBar || !inBar(notes[2])) continue;
		const matched = notes.every((note, index) => note.absBeat === boundary + index - 1 &&
			generated.bassEvents.some(event => event.absBeat === note.absBeat && event.time === note.time && event.midi === note.midi) &&
			(index === 0 || (Number.parseInt(note.time, 10) > Number.parseInt(notes[index - 1].time, 10) &&
				[1, 2].includes((note.midi - notes[index - 1].midi) * direction))));
		// Extra pitched attacks interrupt this exact three-pulse account, even
		// when the exported continuation still lists matching quarter notes.
		const uninterrupted = generated.bassEvents.filter(event => event.absBeat >= boundary - 1 && event.absBeat <= boundary + 1).length === 3;
		if (matched && uninterrupted) bassCard.evidence.push(`Quarter-note line continues ${continuation.direction}ward through the chord change`);
	}
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
	const keyboardTextures: string[] = [];
	const pianoCard: MusicianDecisionCard = {
		instrument: 'piano', title: 'Piano', role: role('piano'), eventCount: piano.length,
		action: piano.length ? 'Support the harmony' : 'No new chord attack',
		detail: piano.length ? 'Comping supports the changes in this bar.' : 'Earlier chords may still sustain through this bar.',
		evidence: [countText(piano.length, 'chord attack'), ...sharedEvidence('piano')]
	};
	const plannedArrival = walking && plan?.performanceEnergy ? plan.piano.arrival : undefined;
	if (plannedArrival && plannedArrival.accentId === plan?.coordinatedAccent?.id) {
		const reasons = {
			shared_arrival: 'join the band on the downbeat', soloist_dense: 'leave room for the soloist',
			deliberate_space: 'keep the planned space', after_response: 'leave space after the response',
			response_reserved: 'keep the assigned response', ensemble_silence: 'keep the planned rest'
		};
		pianoCard.evidence.push(`Planned piano arrival: ${reasons[plannedArrival.reason]}`);
	}
	const feedback = development?.pianoFeedback?.find(entry => entry.barIndex === barIndex);
	const source = feedback?.source;
	// Only a committed previous-bar statement can explain this rolling-bar plan.
	const sourceMatches = !!source && source.barIndex === barIndex - 1 && new Set(source.hits.map(hit => hit.absBeat)).size >= 2 &&
		source.hits.every(hit => hit.role === 'commentary' && ['snare', 'crossstick', 'kick'].includes(hit.drum) &&
			Math.floor(hit.absBeat / beatsPerBar) === source.barIndex &&
			Number.parseInt(hit.time, 10) >= firstTick - beatsPerBar * ppq && Number.parseInt(hit.time, 10) < firstTick &&
			generated.drumEvents.some(event => event.time === hit.time && event.absBeat === hit.absBeat &&
				event.drum === hit.drum && event.velocity === hit.velocity && event.role === hit.role));
	if (plan?.performanceEnergy && feedback?.action === 'yield' && feedback.reason === 'drum_statement' &&
		feedback.originalMaxAttacks > 0 && feedback.effectiveMaxAttacks === 0 && source && sourceMatches) {
		pianoCard.evidence.push(`Drum statement in bar ${source.barIndex + 1}: ${source.hits.map(hit => plain(hit.drum)).join(' · ')}`,
			'Planned space after the drum statement: no new chord attack');
		// A zero budget describes intent; only an empty trace AND score establish scheduled silence.
		if (!feedback.acceptedAttacks.length && !piano.length) pianoCard.evidence.push('Scheduled result: no new chord attack');
	}
	const answer = development?.pianoAnswers?.find(entry => entry.barIndex === barIndex);
	const answerSource = answer?.source;
	const acceptedAnswer = matchesAcceptedPianoAnswer(generated, context, barIndex);
	if (acceptedAnswer) pianoCard.evidence.push(`Answer the drum phrase from bar ${answerSource!.barIndex + 1} with one chord`);
	if (matchesNativeBalladReply(generated, context)) {
		const nativeReply = development!.nativeBalladReplies!.find(entry => entry.barIndex === barIndex)!;
		pianoCard.evidence.push(`Answer the drum color from bar ${nativeReply.source.barIndex + 1} with a late pad`);
	}
	const recovery = development?.pianoRecoveries?.find(entry => entry.barIndex === barIndex);
	const priorAnswer = development?.pianoAnswers?.find(entry => entry.barIndex === barIndex - 1);
	const returning = recovery?.returningDrums;
	const returnedPhrase = development?.drumPhrases.find(entry => entry.barIndex === barIndex);
	const heldPhrase = development?.drumPhrases.find(entry => entry.barIndex === barIndex - 1);
	const originalPhrase = development?.drumPhrases.find(entry => entry.barIndex === priorAnswer?.source.barIndex);
	const sameAttack = (a: typeof generated.compEvents[number], b: typeof generated.compEvents[number]) =>
		a.time === b.time && a.absBeat === b.absBeat && a.duration === b.duration && a.velocity === b.velocity &&
		a.notes.length === b.notes.length && a.notes.every((note, index) => note === b.notes[index]);
	if (walking && plan?.performanceEnergy?.phase === 'solo_build' && recovery?.version === 1 &&
		recovery.action === 'space' && recovery.reason === 'after_drum_reply' && recovery.originalMaxAttacks > 0 && recovery.effectiveMaxAttacks === 0 &&
		recovery.source.barIndex === barIndex - 1 && priorAnswer && sameAttack(recovery.source.attack, priorAnswer.attack) &&
		matchesAcceptedPianoAnswer(generated, context, barIndex - 1) && !recovery.acceptedAttacks.length && !piano.length &&
		!generated.compEvents.some(event => Math.floor(event.absBeat / beatsPerBar) === barIndex) && motif?.transform === 'space' && !motif.hits.length &&
		returning && returning.hits.length > 0 && returnedPhrase?.commentary.source === 'vocabulary' &&
		['repeat', 'displace', 'orchestrate'].includes(returnedPhrase.commentary.transform) &&
		[returnedPhrase, heldPhrase, originalPhrase].every(phrase => phrase?.commentary.motifId === returning.motifId &&
			phrase.commentary.source === 'vocabulary' && phrase.commentary.sourceBar === returning.sourceBar) &&
		returning.hits.length === returnedPhrase.commentary.hits.length && returning.hits.every(hit => hit.role === 'commentary' &&
			Math.floor(hit.absBeat / beatsPerBar) === barIndex && inBar(hit) &&
			generated.drumEvents.some(event => event.time === hit.time && event.absBeat === hit.absBeat && event.drum === hit.drum && event.velocity === hit.velocity && event.role === hit.role) &&
			[returnedPhrase.commentary.hits, returnedPhrase.hits].every(hits => hits.some(event => event.role === 'commentary' && event.drum === hit.drum && event.velocity === hit.velocity && event.beatOffset === hit.absBeat - barIndex * beatsPerBar)))) {
		pianoCard.evidence.push('Leave a breath while the drum phrase returns');
	}

	const plannedTexture = plan?.piano.rootlessTexture;
	if (plannedTexture) {
		const reasons = {
			melody_support: 'leave room for the melody', structural_release: 'ease back', under_response: 'keep light harmony beneath the response',
			solo_development: 'support the solo', active_soloist: 'leave room for the soloist',
			dense_soloist: 'leave room for dense solo activity'
		};
		pianoCard.evidence.push(`Planned rootless texture: ${plannedTexture.request === 'two' ? 'two-note support' : plannedTexture.request === 'three' ? 'three-note support' : 'keep the selected chord shape'} · ${reasons[plannedTexture.reason]}`);
	}
	for (const [index, event] of piano.entries()) {
		pianoCard.evidence.push(`Chord ${index + 1}: ${event.notes.map(noteName).join(' · ')}`);
		const voiced = development?.pianoVoicings?.find((entry) => entry.time === event.time && entry.absBeat === event.absBeat &&
			entry.notes.length === event.notes.length && entry.notes.every((note, i) => note === event.notes[i]));
		if (!voiced) continue;
		const decision = voiced.decision;
		pianoCard.evidence.push(`Chord ${index + 1} voicing: ${plain(decision.resolvedFamily)}${decision.keyboardColor ? ' base with flat ninth' : decision.keyboardSuspension?.kind && decision.keyboardSuspension.phase === 'resolution' ? ' base with resolved color' : ''}`);
		const suspension = decision.keyboardSuspension;
		const colorRoot = suspension?.chordRoot ? PITCH_CLASSES.indexOf(suspension.chordRoot) : -1;
		const colorLabel = suspension?.kind === '9-1' ? 'ninth resolves to root' : suspension?.kind === '13-5' ? 'thirteenth resolves to fifth' : undefined;
		const colorValid = colorLabel && colorRoot >= 0 && suspension!.fromMidi - suspension!.toMidi === 2 &&
			(suspension!.toMidi - colorRoot + 120) % 12 === (suspension!.kind === '9-1' ? 0 : 7);
		if (suspension?.phase === 'suspension' && suspension.suspensionAbsBeat === event.absBeat &&
			(suspension.kind === undefined ? suspension.fromMidi === suspension.toMidi + 1 : colorValid) && event.notes.includes(suspension.fromMidi) &&
			!event.notes.includes(suspension.toMidi) && event.notes.at(-1) !== suspension.fromMidi &&
			Math.floor(suspension.resolutionAbsBeat / beatsPerBar) === Math.floor(event.absBeat / beatsPerBar)) {
			const resolution = generated.compEvents.find(next => next.absBeat === suspension.resolutionAbsBeat &&
				parseInt(next.time) > parseInt(event.time) && next.notes.length === event.notes.length &&
				event.notes.every((note, i) => next.notes[i] === (note === suspension.fromMidi ? suspension.toMidi : note)));
			const receipt = resolution && development?.pianoVoicings?.find(next => next.time === resolution.time &&
				next.absBeat === resolution.absBeat && next.notes.length === resolution.notes.length &&
				next.notes.every((note, i) => note === resolution.notes[i]))?.decision.keyboardSuspension;
			if (receipt?.phase === 'resolution' && receipt.kind === suspension.kind && receipt.chordRoot === suspension.chordRoot && receipt.suspensionAbsBeat === suspension.suspensionAbsBeat &&
				receipt.resolutionAbsBeat === suspension.resolutionAbsBeat && receipt.fromMidi === suspension.fromMidi && receipt.toMidi === suspension.toMidi) {
				pianoCard.evidence.push(`Suspension ${noteName(suspension.fromMidi)} → ${noteName(suspension.toMidi)} · ${colorLabel ?? 'fourth resolves to third'} on the next chord attack`);
				keyboardTextures.push(colorLabel ? 'Color → resolution' : 'Suspension → resolution');
			}
		}
		const connection = decision.keyboardLine;
		if (connection && connection.actualMidi === Math.max(...event.notes) &&
			connection.distance === Math.abs(connection.actualMidi - connection.targetMidi) &&
			connection.ordinaryDistance === Math.abs(connection.ordinaryMidi - connection.targetMidi) &&
			[connection.anchorMidi, connection.targetMidi, connection.actualMidi].every(note => Number.isInteger(note) && note >= 48 && note <= 84)) {
			if (connection.status === 'connected' && connection.distance < connection.ordinaryDistance &&
				connection.guideDetour <= 2 && connection.movementDetour <= 4 && Math.abs(connection.actualMidi - connection.anchorMidi) <= connection.maxTopLeap) {
				pianoCard.evidence.push(`Chord ${index + 1} top voice: ${noteName(connection.anchorMidi)} → ${noteName(connection.actualMidi)} · ${plain(connection.contour)}`);
				keyboardTextures.push('Connected top voice');
			} else if (connection.status === 'bounded_fallback') pianoCard.evidence.push(`Chord ${index + 1} top voice: kept the available voice-led shape`);
		}
		const contrary = decision.keyboardContraryMotion;
		if (contrary && ['changed', 'retained'].includes(contrary.status)) {
			const preceding = generated.compEvents.filter(prior => prior.absBeat < event.absBeat).sort((a, b) => b.absBeat - a.absBeat)[0];
			const index = contrary.voiceIndex;
			if (preceding && Number.isInteger(index) && index! > 0 && index! < event.notes.length - 1 &&
				preceding.notes.length === event.notes.length && contrary.previousNotes.length === preceding.notes.length &&
				contrary.previousNotes.every((note, i) => note === preceding.notes[i]) &&
				contrary.actualNotes.length === event.notes.length && contrary.actualNotes.every((note, i) => note === event.notes[i]) &&
				contrary.fromMidi === preceding.notes[index!] && contrary.toMidi === event.notes[index!] &&
				contrary.topFromMidi === preceding.notes.at(-1) && contrary.topToMidi === event.notes.at(-1) &&
				(contrary.ordinaryNotes.at(-1) === contrary.topToMidi || connection &&
					connection.actualMidi === contrary.topToMidi && Math.abs(contrary.topToMidi - connection.targetMidi) === Math.abs(contrary.ordinaryNotes.at(-1)! - connection.targetMidi)) &&
				Number.isFinite(contrary.guideDetour) && Number.isFinite(contrary.movementDetour) && contrary.guideDetour <= 2 && contrary.movementDetour <= 4 &&
				(contrary.toMidi! - contrary.fromMidi!) * (contrary.topToMidi - contrary.topFromMidi!) < 0 &&
				Math.abs(contrary.toMidi! - contrary.fromMidi!) <= 5) {
				pianoCard.evidence.push(`Inner voice ${noteName(contrary.fromMidi!)} → ${noteName(contrary.toMidi!)} moves against the top line`);
				keyboardTextures.push('Contrary inner voice');
			}
		}
		const articulation = decision.keyboardArticulation;
		if (articulation && articulation.durationSeconds === event.duration && event.duration > 0 &&
			['piano', 'organ'].includes(articulation.instrument) && articulation.profile.includes(articulation.instrument)) {
			pianoCard.evidence.push(`Chord ${index + 1} articulation: ${plain(articulation.profile)} · ${event.duration.toFixed(2)} s`);
		}
		const spacing = decision.spacing;
		const keyboardTexture = decision.keyboardTexture;
		const span = Math.max(...event.notes) - Math.min(...event.notes);
		if (keyboardTexture && spacing && spacing.spanSemitones === span &&
			['rootless-a', 'rootless-b'].includes(decision.resolvedFamily) && [3, 4].includes(event.notes.length)) {
			if (spacing.reason === 'applied' && (spacing.applied === 'compact' && span <= 12 || spacing.applied === 'open' && span >= 14)) {
				pianoCard.evidence.push(`Chord ${index + 1} spacing: ${spacing.applied} · ${span} semitones`);
				const texture = keyboardTexture.profile === 'light' && event.notes.length === 3 ? 'Light' : spacing.applied === 'open' ? 'Open' : 'Compact';
				keyboardTextures.push(`${texture} ${event.notes.length === 3 ? 'three' : 'four'}-note voicing`);
			} else if (spacing.applied === 'unchanged') {
				pianoCard.evidence.push(`Requested ${spacing.request} spacing; kept the available voice-led shape`);
			}
		}
		if (walking && voiced.arrivalId) {
			// Bind the explanation to the actual score position and target bar's
			// admission, including historical exported event positions.
			const targetBar = Math.floor(event.absBeat / beatsPerBar);
			const target = generated.ensemblePlan?.bars.find(entry => entry.barIndex === targetBar);
			const admitted = target?.piano.arrival;
			if (target?.performanceEnergy && admitted?.action === 'catch' && admitted.reason === 'shared_arrival' &&
				admitted.accentId === voiced.arrivalId && target.coordinatedAccent?.id === voiced.arrivalId &&
				target.piano.maxAttacks === 1 && event.absBeat === targetBar * beatsPerBar &&
				generated.compEvents.filter(entry => Math.floor(entry.absBeat / beatsPerBar) === targetBar).length === 1 &&
				generated.bassEvents.some(entry => entry.absBeat === event.absBeat && entry.time === event.time) &&
				generated.drumEvents.some(entry => entry.absBeat === event.absBeat && entry.time === event.time && entry.role === 'accent')) {
				pianoCard.evidence.push(`Chord ${index + 1} arrival: shared catch with bass and drums`);
			}
		}
		const topLine = decision.topLine;
		if ((walking || style === 'bossa-nova') && plan?.performanceEnergy && topLine?.eligible &&
			![decision.requestedFamily, decision.resolvedFamily].some(family => family === 'guide' || family === 'quartal') &&
			Number.isInteger(topLine.targetMidi) && topLine.targetMidi >= 48 && topLine.targetMidi <= 84 &&
			topLine.actualMidi === Math.max(...event.notes) && topLine.distance === Math.abs(topLine.actualMidi - topLine.targetMidi)) {
			pianoCard.evidence.push(`Chord ${index + 1} top-note target: ${noteName(topLine.targetMidi)}; actual top: ${noteName(topLine.actualMidi)}`);
		}
		const texture = decision.rootlessTexture;
		if (texture && texture.noteCount === event.notes.length) {
			const rootless = (family: string) => family === 'rootless-a' || family === 'rootless-b';
			// Timing motion can place this attack in a neighboring sounding bar.
			// Its density evidence belongs to the logical bar that admitted it.
			const sourceBar = Math.floor(event.absBeat / beatsPerBar);
			const sourcePlan = generated.ensemblePlan?.bars.find(entry => entry.barIndex === sourceBar);
			const sourceEvidence = generated.ensemblePlan?.trace?.find(entry => entry.barIndex === sourceBar);
			if (texture.request === 'two' && texture.applied === 'two' && texture.eligible && event.notes.length === 2 &&
				rootless(decision.requestedFamily) && decision.resolvedFamily === decision.requestedFamily &&
				sourcePlan?.piano.rootlessTexture?.request === 'two' && sourcePlan.piano.rootlessTexture.reason === 'dense_soloist' &&
				sourceEvidence?.soloEvidence === 'active' && sourceEvidence.reasons.includes('soloist_dense')) {
				pianoCard.evidence.push(`Chord ${index + 1} texture: two-note support under dense solo activity · 2 notes`);
			} else if (texture.request === 'three' && texture.applied === 'three' && texture.eligible && event.notes.length === 3 &&
				rootless(decision.requestedFamily) && decision.resolvedFamily === decision.requestedFamily) {
				pianoCard.evidence.push(`Chord ${index + 1} texture: three-note rootless support · 3 notes`);
			} else if (texture.applied === 'full') {
				pianoCard.evidence.push(`Chord ${index + 1} texture: selected chord shape kept · ${countText(event.notes.length, 'note')}`);
			}
		}
		if (decision.commonTones.length) pianoCard.evidence.push(`Common tones held: ${decision.commonTones.map(noteName).join(' · ')}`);
		if (decision.guideMotion !== null) pianoCard.evidence.push(`Guide-tone movement: ${countText(decision.guideMotion, 'semitone')} total`);
		if (decision.correction !== 'none') pianoCard.evidence.push(`Voicing adjustment: ${plain(decision.correction)}`);
	}
	if (motif) {
		if (piano.some((event) => Math.floor(event.absBeat / beatsPerBar) === barIndex) && motif.motifId) {
			pianoCard.action = ({ statement: 'Introduce a comping idea', repeat: 'Repeat the comping idea', displace: 'Shift the comping idea',
				answer: 'Answer the comping idea', shorten: 'Shorten the comping idea', space: 'Leave space', fallback: 'Support the harmony' })[motif.transform];
			pianoCard.detail = motif.transform === 'answer' && motif.answerFigureId
				? `A ${plain(motif.answerFigureId)} answers the ${plain(motif.sourceFigureId ?? motif.motifId)} idea.`
				: `The phrase uses ${plain(motif.sourceFigureId ?? motif.motifId)}.`;
			pianoCard.evidence.push(`Motif: ${motif.motifId}`, `Development: ${plain(motif.transform)}`);
			if (motif.transform === 'answer' && motif.answerFigureId) pianoCard.evidence.push(`Answering cell: ${plain(motif.answerFigureId)}`);
		} else if (motif.reason === 'native_pattern') {
			pianoCard.detail = style === 'bossa-nova' ? 'The native bossa comping pattern keeps its rhythmic character.' : 'The native ballad voicing pattern keeps its spacious pacing.';
		}
		if (!motif.motifId && motif.sourceFigureId && piano.length && motif.hits.length) pianoCard.evidence.push(`Comping cell: ${plain(motif.sourceFigureId)}`);
		if (motif.reason) pianoCard.evidence.push(`Comping decision: ${plain(motif.reason)}`);
	}
	// Admission alone is not an audible result: require the native figure's
	// logical onsets and actual scheduled attacks in the displayed bar.
	if (plan?.piano.presence && plan.piano.maxAttacks > 0 && !plan.piano.silenceReason &&
		plan.responseOwner === 'nobody' && motif?.hits.length && piano.length === motif.hits.length &&
		piano.every(event => Math.floor(event.absBeat / beatsPerBar) === barIndex &&
			motif.hits.some(hit => event.absBeat === barIndex * beatsPerBar + hit.b))) {
		pianoCard.evidence.push('Phrase support: a native comping figure keeps the accompaniment connected');
	}
	// A remembered cell is evidence only when both complete statements actually
	// survived admission. Use logical bars for provenance and ticks for display.
	if (walking) for (const recalled of development?.pianoMotifs ?? []) {
		const receipt = recalled.recall;
		if (!receipt) continue;
		const source = receipt.source;
		const original = development?.pianoMotifs.find(entry => entry.barIndex === source.barIndex);
		const sourceArc = generated.ensemblePlan?.bars.find(entry => entry.barIndex === source.barIndex)?.performanceEnergy;
		const currentArc = generated.ensemblePlan?.bars.find(entry => entry.barIndex === recalled.barIndex)?.performanceEnergy;
		const independent = (entry: typeof recalled | undefined) => entry?.transform === 'statement' && !!entry.motifId &&
			entry.sourceFigureId === source.figureId && entry.reason !== 'shared_arrival' && entry.reason !== 'drum_reply';
		const complete = (attacks: typeof receipt.attacks, entry: typeof recalled) => {
			const actual = generated.compEvents.filter(event => Math.floor(event.absBeat / beatsPerBar) === entry.barIndex);
			return attacks.length > 0 && attacks.length === actual.length && attacks.length === entry.hits.length &&
				new Set(attacks.map(event => event.absBeat)).size === attacks.length && attacks.every(attack =>
					entry.hits.some(hit => attack.absBeat === entry.barIndex * beatsPerBar + hit.b) &&
					actual.some(event => event.time === attack.time && event.absBeat === attack.absBeat &&
						event.duration === attack.duration && event.velocity === attack.velocity &&
						event.notes.length === attack.notes.length && event.notes.every((note, index) => note === attack.notes[index])));
		};
		if (!original || original.recall || !independent(original) || !independent(recalled) ||
			source.barIndex !== source.phraseStartBar || original.phraseStartBar !== source.phraseStartBar ||
			recalled.barIndex !== recalled.phraseStartBar || recalled.phraseStartBar !== source.phraseStartBar + 4 ||
			!sourceArc || !currentArc || !['solo_build', 'solo_peak'].includes(sourceArc.phase) || !['solo_build', 'solo_peak'].includes(currentArc.phase) ||
			sourceArc.chorusIndex !== source.chorusIndex || currentArc.chorusIndex !== source.chorusIndex ||
			!source.attacks.every(attack => Number.parseInt(attack.time, 10) < Math.min(...receipt.attacks.map(event => Number.parseInt(event.time, 10)))) ||
			receipt.attacks.length !== source.attacks.length || !receipt.attacks.every((attack, index) =>
				attack.absBeat - recalled.barIndex * beatsPerBar === source.attacks[index].absBeat - source.barIndex * beatsPerBar) ||
			!complete(source.attacks, original) || !complete(receipt.attacks, recalled) || !receipt.attacks.some(inBar)) continue;
		pianoCard.evidence.push(`Recall the piano cell from bar ${source.barIndex + 1}`);
	}
	if (plan?.piano.silenceReason) pianoCard.evidence.push(`Space reserved: ${plain(plan.piano.silenceReason)}`);
	if (plan?.performanceEnergy?.phase === 'head_return' && plan.piano.silenceReason === 'returning_melody' &&
		plan.piano.maxAttacks === 0 && !piano.length &&
		!generated.compEvents.some(event => Math.floor(event.absBeat / beatsPerBar) === barIndex) &&
		motif?.transform === 'space' && motif.reason === 'ensemble_silence' && !motif.hits.length) {
		pianoCard.action = 'Make room for the returning melody';
		pianoCard.detail = 'The piano leaves space after the returning head’s arrival.';
		pianoCard.evidence.push('Scheduled result: no new chord attack during the returning-melody breath');
	}
	if (plan?.piano.texture) pianoCard.evidence.push(plan.piano.texture === 'steady'
		? 'Planned piano texture: regular, light support' : 'Planned piano texture: sparse phrase contrast');
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
		if (drumPhrase.ride.voice) drumCard.evidence.push(`Cymbal color planned: ${plain(drumPhrase.ride.voice)}`);
		if (drumPhrase.ride.voice === 'ride-bell' && drums.some((event) => event.drum === 'ride-bell' && event.role === 'timekeeping' && Math.floor(event.absBeat / beatsPerBar) === barIndex)) {
			drumCard.detail = 'The ride bell colors the pulse through this selected peak phrase.';
		}
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
	const cushion = drumPhrase?.cushioning;
	if (cushion && cushion.basis === 'structural_keyboard_release' && cushion.phase === plan?.performanceEnergy?.phase &&
		piano.some(event => event.absBeat === barIndex * beatsPerBar + cushion.compAttack.beatOffset &&
			event.time === cushion.compAttack.time && event.duration === cushion.compAttack.durationSeconds) &&
		cushion.removedHits.length + cushion.softenedHits.length > 0) {
		const matches = (event: typeof drums[number], hit: { beatOffset: number; drum: string; velocity: number; role?: string }) =>
			event.absBeat === barIndex * beatsPerBar + hit.beatOffset && event.drum === hit.drum && event.velocity === hit.velocity && event.role === hit.role;
		if (cushion.removedHits.every(hit => !drums.some(event => event.drum === hit.drum && event.absBeat === barIndex * beatsPerBar + hit.beatOffset)) &&
			cushion.softenedHits.every(({before, after}) => before.drum === after.drum && before.beatOffset === after.beatOffset &&
				before.role === after.role && after.velocity > 0 && after.velocity < before.velocity && drums.some(event => matches(event, after)))) {
			drumCard.action = 'Ease around the resolution';
			drumCard.detail = 'The kit softens the end of this phrase around the keyboard while keeping the native pulse.';
			drumCard.evidence.push(`Phrase cushioning: ${cushion.removedHits.length} optional hits withheld · ${cushion.softenedHits.length} hits softened`);
		}
	}
	if (acceptedAnswer) drumCard.evidence.push('Leave commentary space for the piano answer');
	if (plan?.drums.silenceReason) drumCard.evidence.push(`Commentary space: ${plain(plan.drums.silenceReason)}`);
	const candidateTerminal = plan?.terminalArrangement;
	const balladTerminal = style === 'ballad' && candidateTerminal?.profile === 'ballad-v1';
	const bossaTerminal = style === 'bossa-nova' && candidateTerminal?.profile === 'bossa-v1';
	const terminal = (walking && candidateTerminal?.profile === undefined) || balladTerminal || bossaTerminal ? candidateTerminal : undefined;
	if (terminal?.version === 1 && terminal.barIndex === barIndex && terminal.absBeat === barIndex * beatsPerBar &&
		plan?.performanceEnergy?.phase === 'ending' && terminal.holdBeats >= 2 && terminal.holdBeats <= beatsPerBar &&
		terminal.releaseBeat === terminal.absBeat + terminal.holdBeats && terminal.participants.length === 3 &&
		['bass', 'piano', 'drums'].every(instrument => terminal.participants.includes(instrument as 'bass' | 'piano' | 'drums'))) {
		const cards = [bassCard, pianoCard, drumCard];
		for (const card of cards) card.evidence.push('Planned ending: hold and release together');
		const receipt = development?.terminalArrangements?.find(entry => entry.version === 1 && entry.reservationId === terminal.id && entry.barIndex === barIndex);
		if (receipt?.status === 'withheld') {
			const reason = receipt.reason === 'preceding_release' ? 'an earlier note is still sustaining' : 'the closing chord could not be scheduled';
			for (const card of cards) card.evidence.push(`Ending not applied: ${reason}`);
		} else if (receipt?.status === 'accepted') {
			const onCue = (event: { time: string; absBeat: number }) => event.time === `${firstTick}i` && event.absBeat === terminal.absBeat;
			const sourceBass = receipt.bass; const sourcePiano = receipt.piano;
			const validDrumKit = bossaTerminal
				? receipt.drums.length >= 2 && receipt.drums.length <= 3 &&
					receipt.drums.some(event => event.drum === 'kick') && receipt.drums.some(event => event.drum === 'hihat') &&
					receipt.drums.every(event => ['kick', 'hihat', 'crossstick'].includes(event.drum))
				: (balladTerminal ? receipt.drums.length >= 1 && receipt.drums.length <= 2 : receipt.drums.length === 2) &&
					receipt.drums.some(event => event.drum === 'ride') && receipt.drums.every(event => ['ride', 'kick'].includes(event.drum));
			const matched = !plan.bass.keepPulse && !plan.drums.keepTime && bass.length === 1 && piano.length === 1 && drums.length === receipt.drums.length &&
				validDrumKit && new Set(receipt.drums.map(event => event.drum)).size === receipt.drums.length &&
				receipt.drums.every(event => event.role === 'accent') &&
				[sourceBass, sourcePiano, ...receipt.drums].every(onCue) && sourceBass.duration > 0 && sourceBass.duration === sourcePiano.duration &&
				bass[0].time === sourceBass.time && bass[0].absBeat === sourceBass.absBeat && bass[0].midi === sourceBass.midi && bass[0].duration === sourceBass.duration && bass[0].velocity === sourceBass.velocity &&
				piano[0].time === sourcePiano.time && piano[0].absBeat === sourcePiano.absBeat && piano[0].duration === sourcePiano.duration && piano[0].velocity === sourcePiano.velocity &&
				piano[0].notes.length === sourcePiano.notes.length && piano[0].notes.every((note, index) => note === sourcePiano.notes[index]) &&
				receipt.drums.every(hit => drums.some(event => event.time === hit.time && event.absBeat === hit.absBeat && event.drum === hit.drum && event.velocity === hit.velocity && event.role === hit.role));
			if (matched) {
				let drumDetail = 'A restrained cymbal and kick catch the closing chord.';
				if (balladTerminal) drumDetail = receipt.drums.some(event => event.drum === 'kick')
					? 'A quiet ride and soft kick catch the closing chord.' : 'A quiet ride catches the closing chord.';
				if (bossaTerminal) drumDetail = receipt.drums.some(event => event.drum === 'crossstick')
					? 'Kick, stick hat and crossstick catch the closing chord.' : 'Kick and stick hat catch the closing chord.';
				for (const card of cards) {
					card.role = roles.mark_form;
					card.action = card.instrument === 'drums' ? 'Catch the final chord' : 'Hold the final chord';
					card.detail = card.instrument === 'drums' ? drumDetail : 'The final chord is held, with no further attacks in this bar.';
					card.evidence.push('Scheduled ending: shared final chord, then space');
				}
			}
		}
	}
	if (development && walking) {
  const close=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-8;
  if(bass.length===4 && bass.every((e,i)=>e.absBeat===barIndex*4+i && e.expression?.kind==='walking-backbeats' &&
   e.expression.part===(i%2?'answer':'statement') && e.expression.originalVelocity>0 && close(e.velocity,e.expression.originalVelocity*(i%2?1.1:.9)))) {
   bassCard.action='Buoyant walking';
   bassCard.detail+=' Beats two and four have a little more weight; one and three stay lighter.';
   bassCard.evidence.push('Walking expression: lighter 1 / 3 · stronger 2 / 4');
  }
  if(piano.length===2 && piano.every((e,i)=>e.expression?.kind==='short-held' && e.expression.part===(i?'answer':'statement') &&
   e.expression.originalDuration!>0 && close(e.velocity,e.expression.originalVelocity)) &&
   piano[1].duration>=2*piano[0].duration && piano[0].duration+piano[1].duration+1e-8>=piano.reduce((n,e)=>n+e.expression!.originalDuration!,0) && parseInt(piano[0].time)<parseInt(piano[1].time)) {
   pianoCard.action='Short chord → held answer';
   pianoCard.detail='A detached first chord leads to longer harmonic support on the next existing attack.';
   pianoCard.evidence.push(`Short/held contrast: ${piano[0].duration.toFixed(2)} s → ${piano[1].duration.toFixed(2)} s`);
  }
  const ghosted=drums.filter(e=>e.expression?.kind==='ghost-answer');
  if(ghosted.length && ghosted.every(e=>e.drum==='snare' && e.role==='commentary' && e.expression!.originalVelocity>0 && ['statement','answer'].includes(e.expression!.part) &&
   close(e.velocity,e.expression!.originalVelocity*(e.expression!.part==='answer'?.5:1.08)) &&
   drumPhrase?.commentary.hits.some(h=>h.expression?.kind==='ghost-answer' && h.expression.part===e.expression!.part &&
    h.drum===e.drum && close(h.beatOffset,e.absBeat-barIndex*4) && close(h.velocity,e.velocity)))) {
   drumCard.action=drumPhrase?.commentary.transform==='setup'?'Shape the fill':'Ghosted snare answer';
   drumCard.detail=drumPhrase?.commentary.transform==='setup'?'A softer inner snare stroke gives the fill shape; its launch and landing stay strong.':'The snare statement has a softer answering stroke, while the cymbal pulse continues.';
   drumCard.evidence.push('Snare expression: ghosted inner stroke / answer');
  }
 }
 if(development) {
  const repeated=bass.find(e=>e.conversation?.kind==='repeated-bass');
  const source=repeated?.conversation;
  const actualRepeat=walking && repeated && source?.kind==='repeated-bass' && bass.length===4 &&
   repeated.absBeat===barIndex*4+1 && repeated.midi===source.sourceMidi && source.originalMidi!==repeated.midi &&
   source.sourceAbsBeat===barIndex*4 && bass.some(e=>e.absBeat===source.sourceAbsBeat&&e.midi===source.sourceMidi);
  if(actualRepeat) {
   bassCard.action='Repeat, then move';
   bassCard.detail='The first walking note repeats on beat two, then the line moves on toward the next harmony.';
   bassCard.evidence.push('Repeated-note propulsion: beats 1 and 2 share the same sounded pitch');
  }
  const catchHit=drums.find(e=>e.conversation?.kind==='bass-catch'),catchReceipt=catchHit?.conversation;
  if(actualRepeat && catchHit && catchReceipt?.kind==='bass-catch' && catchHit.drum==='kick' && catchHit.role==='timekeeping' &&
   catchHit.absBeat===barIndex*4+2 && catchReceipt.sourceAbsBeat===source.sourceAbsBeat && catchReceipt.repeatAbsBeat===repeated.absBeat &&
   catchReceipt.sourceMidi===repeated.midi && catchReceipt.originalVelocity>0 && catchReceipt.originalVelocity<=.24 &&
   Math.abs(catchHit.velocity-catchReceipt.originalVelocity*1.7)<1e-8 && drumPhrase?.hits.some(h=>h.drum==='kick'&&h.beatOffset===2&&
    h.velocity===catchHit.velocity&&JSON.stringify(h.conversation)===JSON.stringify(catchReceipt))) {
   drumCard.action='Catch the bass figure';
   drumCard.detail='A little extra weight on the existing beat-three kick answers the bass’s repeated note; the cymbal timekeeper keeps its pulse.';
   drumCard.evidence.push('Bass dialogue: repeated bass on 1 / 2 → kick on 3');
  }
  for(const event of piano) {
   const c=event.conversation;
   const trace=development.pianoVoicings?.find(v=>v.time===event.time&&v.absBeat===event.absBeat&&v.notes.length===event.notes.length&&v.notes.every((n,i)=>n===event.notes[i]));
   if(c?.kind==='dominant-b9'&&c.fromMidi-c.toMidi===1&&(c.toMidi-c.rootPc+120)%12===1&&
    (c.targetRootPc-c.rootPc+12)%12===5&&event.notes.includes(c.toMidi)&&!event.notes.includes(c.fromMidi)&&event.notes.at(-1)!==c.toMidi&&
    [4,10].every(pc=>event.notes.some(n=>(n-c.rootPc+120)%12===pc))&&JSON.stringify(trace?.decision.keyboardColor)===JSON.stringify(c)) {
    pianoCard.action='Color the dominant';
    pianoCard.detail='An inner ninth drops to a flat ninth before the next written harmony. The top voice and harmonic support stay in place.';
    pianoCard.evidence.push(`Altered dominant: ${noteName(c.fromMidi)} → ${noteName(c.toMidi)} · flat ninth`);
   }
  }
 }
 if(development) {
  const seventh=bass.find(e=>e.phraseColor?.kind==='root-seventh');
  const color=seventh?.phraseColor;
  if(walking && seventh && color?.kind==='root-seventh' && bass.length===4 &&
   bass.every((e,i)=>e.absBeat===barIndex*4+i) && seventh.absBeat===barIndex*4+1 &&
   bass[0].midi===color.rootMidi && seventh.midi===color.rootMidi+color.seventh-12 && seventh.midi!==color.originalMidi) {
   bassCard.action='Root → seventh';
   bassCard.detail='A small downward dip on beat two gives the walking line shape; the final approach continues unchanged.';
   bassCard.evidence.push(`Walking color: ${noteName(color.rootMidi)} → ${noteName(seventh.midi)}`);
  }
  for(const event of piano) {
   const c=event.phraseColor;
   const trace=development.pianoVoicings?.find(v=>v.time===event.time&&v.absBeat===event.absBeat&&v.notes.length===event.notes.length&&v.notes.every((n,i)=>n===event.notes[i]));
   if(c?.kind==='upper-structure' && event.notes.length===5 && event.notes.includes(c.addedMidi) &&
    (c.addedMidi-c.rootPc+120)%12===6 && [2,4,6,9,10].every(pc=>event.notes.some(n=>(n-c.rootPc+120)%12===pc)) &&
    JSON.stringify(trace?.decision.upperStructure)===JSON.stringify(c)) {
    const articulation=pianoCard.action==='Short chord → held answer' ? ' Short chord → held answer: a detached first chord leads into the longer colored chord.' : '';
    pianoCard.action='Upper-triad color';
    pianoCard.detail='A bright major triad sits above the dominant shell: ninth, sharp eleventh and thirteenth. The existing rhythm and held support remain.'+articulation;
    pianoCard.evidence.push('Sounded voicing: 3 / 7 shell + 9 / ♯11 / 13');
   }
  }
  const hats=drums.filter(e=>e.drum==='hihat'&&e.role==='timekeeping');
  if(walking && drumPhrase?.ride.voice==='hihat' && hats.length>0 &&
   !drums.some(e=>e.drum==='ride'&&e.role==='timekeeping') &&
   hats.every(e=>drumPhrase.hits.some(h=>h.drum==='hihat'&&h.role==='timekeeping'&&h.velocity===e.velocity&&Math.abs(h.beatOffset-(e.absBeat-barIndex*4))<1e-8))) {
   if(!['Catch the bass figure','Ease around the resolution','Shape the fill','Ghosted snare answer'].includes(drumCard.action)){
    drumCard.action='Stick hi-hat time';
    drumCard.detail='The right hand moves the cymbal pulse to a quieter closed hi-hat for this phrase. Foot time and existing commentary continue.';
   }
   else drumCard.detail+=' The right-hand timekeeping texture is closed stick hi-hat.';
   drumCard.evidence.push('Phrase texture: closed stick hi-hat replaces ride time');
  }
 }

 if(development) {
  const c=bass[0]?.ensembleColor;
  if(walking && c?.kind==='arpeggio' && bass.length===4 && bass.every((e,i)=>e.absBeat===barIndex*4+i) &&
   bass.slice(0,3).every((e,i)=>e.midi===[c.rootMidi,c.rootMidi+c.third,c.rootMidi+7][i] && JSON.stringify(e.ensembleColor)===JSON.stringify(c)) && bass[3].midi===c.originalNotes[3]) {
   bassCard.action='Outline the chord';
   bassCard.detail='The walking line climbs through root, third and fifth before returning to its final approach. Four pulses keep the groove moving.';
   bassCard.evidence.push(`Chord outline: ${bass.slice(0,3).map(e=>noteName(e.midi)).join(' → ')}`);
  }
  for(const event of piano) {
   const c=event.ensembleColor;
   const trace=development.pianoVoicings?.find(v=>v.time===event.time&&v.absBeat===event.absBeat&&JSON.stringify(v.notes)===JSON.stringify(event.notes));
   if(c?.kind==='drop3' && c.originalNotes.length===4 && c.fromMidi===c.originalNotes[1] && c.toMidi===c.fromMidi-12 &&
    JSON.stringify(event.notes)===JSON.stringify([c.toMidi,c.originalNotes[0],...c.originalNotes.slice(2)]) && JSON.stringify(trace?.decision.spreadVoicing)===JSON.stringify(c)) {
    const articulation=pianoCard.action==='Short chord → held answer'?' Short chord → held answer: a detached first chord leads into this longer, wider chord.':'';
    pianoCard.action='Open drop-3 voicing';
    pianoCard.detail='One inner voice drops an octave, opening the chord beneath the same melody note. The rhythm and held harmonic support remain.'+articulation;
    pianoCard.evidence.push(`Wider chord: ${noteName(c.fromMidi)} → ${noteName(c.toMidi)} · top voice unchanged`);
   }
  }
  for(const event of drums) {
   const c=event.ensembleColor;
   const source=c?.kind==='cross-stick'?piano.find(e=>e.absBeat===c.sourceAbsBeat&&e.time===c.sourceTime&&e.duration===c.sourceDuration&&JSON.stringify(e.notes)===JSON.stringify(c.sourceNotes)):undefined;
   if(c?.kind==='cross-stick' && source && event.drum==='crossstick' && event.role==='commentary' && event.velocity===c.originalVelocity*.85 &&
    event.absBeat-source.absBeat>=.5 && parseInt(event.time)>parseInt(source.time) && parseInt(event.time)<c.sourceEndTick && drumPhrase?.hits.some(h=>h.drum===event.drum&&h.beatOffset===event.absBeat-barIndex*4&&h.velocity===event.velocity&&JSON.stringify(h.ensembleColor)===JSON.stringify(c))) {
    drumCard.action='Cross-stick under the chord';
    drumCard.detail='An existing snare comment becomes a quieter, woody cross-stick while the keyboard chord is still held. The cymbal groove continues.';
    drumCard.evidence.push(`Held-chord response: cross-stick after beat ${source.absBeat-barIndex*4+1}`);
   }
  }
 }

	if (keyboardTextures.length) pianoCard.detail += ` ${piano.some(e=>e.phraseColor?.kind==='upper-structure'||e.ensembleColor?.kind==='drop3')?'Other attacks: ':''}${[...new Set(keyboardTextures)].join(', then ')}.`;
	return [bassCard, pianoCard, drumCard];
}
