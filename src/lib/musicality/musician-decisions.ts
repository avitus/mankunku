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
			melody_support: 'leave room for the melody', structural_release: 'ease back',
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
		pianoCard.evidence.push(`Chord ${index + 1} voicing: ${plain(decision.resolvedFamily)}`);
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
				shorten: 'Shorten the comping idea', space: 'Leave space', fallback: 'Support the harmony' })[motif.transform];
			pianoCard.detail = `The phrase uses ${plain(motif.sourceFigureId ?? motif.motifId)}.`;
			pianoCard.evidence.push(`Motif: ${motif.motifId}`, `Development: ${plain(motif.transform)}`);
		} else if (motif.reason === 'native_pattern') {
			pianoCard.detail = style === 'bossa-nova' ? 'The native bossa comping pattern keeps its rhythmic character.' : 'The native ballad voicing pattern keeps its spacious pacing.';
		}
		if (motif.reason) pianoCard.evidence.push(`Comping decision: ${plain(motif.reason)}`);
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
	return [bassCard, pianoCard, drumCard];
}
