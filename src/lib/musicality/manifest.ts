import {
	parseMusicalitySpec, validateMusicalityManifest,
	type ImplementationStatus, type MusicalityAudit, type MusicalityEvidence, type MusicalityRequirement
} from './spec';

/** Evidence is pinned to the inspected engine, independently of the serving app build. */
export const MUSICALITY_AUDIT_DATE = '2026-10-15';
export const MUSICALITY_AUDIT_REVISION = 'ced5186931aafc4b75151d8704db88217861672c';
export const MUSICALITY_AUDIT_SCOPE = 'Source inspection of the reachable accompaniment engine. Core devices are distinguished from their missing musical context. Test links are references, not a claim that this audit ran them. The new specification has not passed a listening acceptance review.';

const source = (file: string, line = 1): MusicalityEvidence => ({ kind: 'source', path: `src/lib/audio/${file}.ts`, line });
const test = (file: string): MusicalityEvidence => ({ kind: 'test', path: `tests/unit/audio/${file}.test.ts` });
const generation = [source('backing-generation', 516), test('backing-generation')];
const comp = [source('backing-comp-figures', 45), source('backing-generation', 350), test('backing-comp-figures')];
const voicings = [source('voicings', 41), source('backing-generation', 320), test('voicings')];
const bass = [source('backing-bass', 191), source('backing-generation', 541), test('backing-bass')];
const drums = [source('backing-drum-vocab', 30), source('backing-styles', 198), test('backing-drum-vocab')];
const timing = [source('backing-timing', 92), test('backing-timing')];
const energy = [source('backing-intensity', 40), test('backing-intensity')];
const evaluation = [source('backing-report', 73), test('backing-report'), test('backing-golden')];
const listening: MusicalityEvidence[] = [{ kind: 'listening', path: 'documentation/contributing/backing-listening.md', label: 'Historical listening protocol and milestone log' }];

/** Every row is an evidence-backed claim; adding vocabulary does not automatically promote it. */
function row(id: string, status: ImplementationStatus, assessment: string, remaining: string, evidence: MusicalityEvidence[], scope = 'Swing accompaniment in 4/4; other styles may use different policies.'): MusicalityAudit {
	return { id, status, assessment, remaining, scope, evidence, validation: { method: 'source-audit', listening: 'not-assessed' } };
}

type SectionReview = [number, ImplementationStatus, string, string, MusicalityEvidence[]];
const sections: SectionReview[] = [
	[1, 'partial', 'Form metadata, intensity and multi-bar comp planning already influence generation.', 'A shared phrase intention and instrument role assignment are not yet the organizing pipeline.', generation],
	[2, 'partial', 'All players receive bar position, section flags, chorus index, swing and intensity.', 'Add solo observations, explicit phrase state, tension, shared memory and ensemble decisions.', generation],
	[3, 'partial', 'Weighted seeded choices, comp repetition penalties and form cues exist.', 'Density balancing, solo response and a common phrase hierarchy remain incomplete.', [...comp, ...energy]],
	[4, 'partial', 'Swing varies with tempo and instruments have separate timing profiles.', 'Timing still adds independent event jitter; correlated phrase timing is absent.', timing],
	[5, 'partial', 'Comping includes silence, short and sustained figures, anticipation and voiced harmony.', 'Comping cannot yet listen to the soloist or negotiate space with the drummer.', comp],
	[6, 'partial', 'Several one- and two-bar rhythmic devices are reachable.', 'See each P1–P15 row for missing vocabulary and context.', comp],
	[7, 'partial', 'Shell, rootless A/B, guide-tone, drop-2 and selected quartal shapes are reachable.', 'Several voicing families and context-aware selection policies remain absent.', voicings],
	[8, 'partial', 'The voicing sequence minimizes movement and tracks a register target.', 'Common-tone, guide-tone and top-note lines need explicit musical objectives.', voicings],
	[9, 'partial', 'Existing altered chord qualities can color voicings.', 'No shared reharmonization plan or contextual substitution devices.', voicings],
	[10, 'partial', 'Comp silence, intensity weighting and anticipations exist.', 'No live soloist response, register avoidance or piano response to drums.', comp],
	[11, 'partial', 'A target-and-approach walking planner establishes pulse and connects harmonies.', 'Solo-aware restraint and shared phrase intentions remain incomplete.', bass],
	[12, 'partial', 'Walking, initial two-feel, a structural switch to walking and occasional triplets exist.', 'Several time devices and explicit head/solo role conditioning remain absent.', bass],
	[13, 'partial', 'Chord-tone targets, scale motion, chromatic approaches and register arcs exist.', 'More deliberate multi-bar contour and repetition development are still needed.', bass],
	[14, 'not-implemented', 'No bass harmonic-substitution device policy was found in the reachable planner.', 'Add shared bass/piano harmonic agreement before substitutions.', bass],
	[15, 'partial', 'Note lengths and velocity shape walking; occasional pitched ghosts exist.', 'Muted notes, slides and other articulations require event and renderer support.', bass],
	[16, 'partial', 'Section endings and intensity affect bass activity.', 'No soloist listening; a two-bar turnaround trajectory is not explicitly planned.', bass],
	[17, 'partial', 'Ride-based timekeeping, commentary and form punctuation exist.', 'The drummer lacks shared phrase memory, solo listening and turn-taking.', drums],
	[18, 'partial', 'Ride patterns vary by bar and intensity.', 'Develop 2–4-bar ride phrases rather than independent bar choices.', drums],
	[19, 'partial', 'Backbeat hats and some offbeat accents exist.', 'Swing uses stick-hat samples rather than the specified foot hi-hat; other textures are absent.', drums],
	[20, 'partial', 'Soft snare commentary, offbeat notes, triplets and piano echoes exist.', 'Multi-bar motifs, solo phrase responses and advanced articulations are absent.', drums],
	[21, 'partial', 'Feathering, comp catches, bombs and form punctuation exist.', 'Several rhythmic devices and deliberate dialogue development remain incomplete.', drums],
	[22, 'partial', 'Existing kit voices are combined into short fills.', 'The kit has no tom voices or general orchestration transformations.', drums],
	[23, 'partial', 'Additions are limited and crashes displace coincident ride strokes.', 'No general limb model or coordinated ensemble-hit contract.', drums],
	[24, 'partial', 'Section/chorus flags drive setups, fills and accents.', 'Full 4/8-bar hierarchy, structural dropout and arrangement-aware setup ownership are missing.', drums],
	[25, 'partial', 'Drums can echo piano attacks and catch bass pickups.', 'No reciprocal dialogue, solo listening, reasoned full-kit silence or peak-release memory.', drums],
	[26, 'partial', 'Some onset coupling and drum collision constraints already coordinate the band.', 'Allocate responses, protect space, balance commentary and share harmonic interpretation.', generation],
	[27, 'not-implemented', 'Pitch and onset capture exist elsewhere, but no solo-feature model feeds accompaniment.', 'Add causal, confidence-aware activity/rest/density/register observations and bleed protection.', [source('pitch-detector', 86), source('onset-detector', 33), ...generation]],
	[28, 'partial', 'Intensity can change probabilities and color.', 'Solo-density response, rest windows and register avoidance are absent.', energy],
	[29, 'partial', 'Comp figures have IDs, weights, tags and busyness metadata.', 'General device requirements, compatibility, cooldowns and context metadata are not shared across players.', comp],
	[30, 'partial', 'Related rhythmic figures and some variants exist.', 'A reusable cross-instrument family/transform contract is missing.', comp],
	[31, 'partial', 'Comp figures and bass register arcs span several bars.', 'No shared phrase intention assigns coordinated behaviors to all instruments.', [...comp, ...bass]],
	[32, 'partial', 'Timing profiles separate swing placement, role offset and random jitter.', 'Shared phrase drift and intent-aware coordinated timing are absent.', timing],
	[33, 'partial', 'Velocity hierarchy, intensity changes and sample layers shape dynamics.', 'A shared dynamic phrase and soloist-relative intensity model remain incomplete.', [...drums, ...energy]],
	[34, 'partial', 'Bass and piano have bounded registers and voice-leading targets.', 'No soloist register avoidance or general cross-instrument collision resolver.', [...bass, ...voicings]],
	[35, 'partial', 'Swing, straight, bossa and ballad profiles have distinct generators and timing.', 'The specification’s traditional/bebop/post-bop vocabulary profiles are not represented.', [source('backing-styles', 122), test('backing-straight'), test('backing-bossa'), test('backing-ballad')]],
	[36, 'not-implemented', 'No musical-complexity level selects available accompaniment vocabulary.', 'Separate vocabulary eligibility from note density before adding complexity levels.', generation],
	[37, 'partial', 'Existing guards address repeated bass notes, comp repetition and impossible drum doubling.', 'Several ensemble anti-patterns remain possible without intent, response ownership and shared memory.', [...bass, ...comp, ...drums]],
	[38, 'partial', 'Comp remembers recent figures; bass retains local contour history.', 'Shared 1–2-bar, 4–16-bar and whole-performance musical memory is missing.', [...comp, ...bass]],
	[39, 'partial', 'Fixed multi-bar figures provide recognizable related material.', 'Transform and develop motifs explicitly rather than only choosing another figure.', comp],
	[40, 'partial', 'Piano rest and sparse figures are explicit choices; some drum voices may omit hits.', 'Silence needs duration, reason and ensemble-level ownership.', [...comp, ...drums]],
	[41, 'partial', 'Deterministic generation is separated from rendering and timing.', 'Insert shared intention, role allocation, conflict resolution and validation before event commitment.', generation],
	[42, 'partial', 'Drum hits are deduplicated and crashes replace conflicting ride/hats.', 'Add ensemble density, register, harmonic and response-conflict checks.', [source('backing-generation', 465), ...drums]],
	[43, 'reference', 'These probabilities are proposed starting points, not fixed implementation requirements.', 'Tune context-dependent distributions through measured outputs and listening.', evaluation],
	[44, 'partial', 'Property tests, golden outputs, statistics and a listening lab exist.', 'Ensemble, interaction and phrase-development metrics need coverage.', evaluation],
	[45, 'partial', 'The report measures bass intervals/roots/repeats, piano density/rests and drum activity.', 'Add solo-gap responses, register overlap, device repetition, fill frequency and ensemble density.', evaluation],
	[46, 'partial', 'Six seeded golden cases cover swing, bossa, ballad and straight styles.', 'Add the specification’s A–F situations, especially dense/sparse soloists and chorus release.', [test('backing-golden'), source('backing-lab-presets', 1)]],
	[47, 'partial', 'Blind A/B, WAV bounce, event replay and historical listening milestones exist.', 'The new specification has not received a fresh human acceptance pass.', listening],
	[48, 'reference', 'This is the proposed implementation sequence.', 'Track evidence per requirement as phases are implemented; phase completion alone is not musical acceptance.', generation],
	[49, 'reference', 'This is the proposed minimum vocabulary and interaction set.', 'Use its linked device and ensemble requirements to assess delivery.', generation],
	[50, 'reference', 'These are listening acceptance criteria, not a checklist satisfied by legal notes.', 'A fresh, recorded listening review must establish whether the complete rhythm section meets them.', listening]
];

const pianoImplemented = [2, 3, 5, 6, 11, 14, 18, 19, 23, 57];
const pianoPartial: Record<number, string> = {
	4: 'A related displaced figure exists, but not the specified and-of-1 / beat-3 reverse Charleston.',
	12: 'Fixed two-bar figures exist; no generated motif is varied across 2–4 bars.',
	13: 'Displaced variants are separate fixed figures rather than transformations of remembered motifs.',
	16: 'Shell shapes exist, but roots are not conditionally omitted when a bassist is present.',
	17: 'Guide-tone shapes exist; their motion is not a dominant sequence-level constraint.',
	21: 'Drop-2 spreads some voicings, without the specified solo-register/texture conditions.',
	22: 'Compact rootless shapes exist; attack character does not select closed voicings.',
	25: 'Quartal shapes are restricted to supported qualities; no modal/static/post-bop context policy.',
	31: 'Movement minimization can retain common tones, without an explicit retention objective.',
	35: 'Voice leading minimizes movement, without planning a melodic line through guide tones.',
	36: 'Register targets influence inversions, without an explicit coherent top-note contour.',
	48: 'Existing altered chord qualities supply color; no solo/harmony-aware tension choice.',
	49: 'Some bars use guide-tone voicings, but not in response to harmonically active soloing.',
	56: 'Intensity changes weights, voicings and register; no coordinated multi-bar build intent.',
	58: 'Anticipation and push figures exist; no explicit shared phrase-launch intention.'
};

const bassImplemented = [1, 5, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 29, 33, 34, 47, 58];
const bassPartial: Record<number, string> = {
	2: 'Two-feel can occur on the first mapped chorus; no head-role, solo-density or energy conditioning.',
	3: 'A two-feel section can escape to a whole walking bar, without a within-bar broken-two device.',
	7: 'Offbeat pickups exist, but need not anticipate the upcoming harmony.',
	8: 'A chord may start on its third or fifth, without planning a delayed root arrival.',
	26: 'Sevenths are candidates, without a deliberate root-to-seventh device.',
	27: 'Chord-tone candidates exist, without arpeggio-continuation intention.',
	28: 'Direction history crosses segments, but each harmonic target is still planned separately.',
	30: 'Independent four-bar register arcs do not constitute a coordinated long wave contour.',
	35: 'Third/fifth starts exist, without seventh targets, repeated-harmony weighting or a later root plan.',
	38: 'Strong beats favor chord tones and weak beats favor connectors; no named bebop connection plan.',
	50: 'A soft pitched ghost exists; there is no muted-note articulation capability.',
	57: 'Intensity affects ornaments; approach weights and contour amplitude do not share a full build plan.',
	59: 'Generic final-bar approaches and triplets exist, without a planned two-bar turnaround trajectory.'
};
const bassLines: Record<number, number> = { 1: 472, 2: 191, 3: 344, 5: 191, 7: 606, 8: 251, 10: 617, 14: 247, 15: 488, 16: 84, 17: 280, 18: 299, 19: 295, 20: 284, 21: 293, 22: 280, 23: 282, 24: 543, 25: 558, 26: 488, 27: 488, 28: 519, 29: 140, 30: 165, 33: 180, 34: 401, 35: 251, 38: 485, 47: 583, 50: 597, 57: 630, 58: 617, 59: 617 };

const drumsImplemented = [2, 3, 5, 19, 21, 22, 25, 32, 37, 38, 40, 41, 42, 45, 46, 47, 54, 55, 58, 59, 60, 62, 67, 68, 70, 76, 84];
const drumsPartial: Record<number, string> = {
	1: 'Ride skips and velocity vary, but note length and a developing multi-bar phrase are absent.',
	7: 'Bell color appears at boundaries, without a sustained energy-driven bell texture.',
	13: 'Quarter-only ride is sparser than swung ride, but still fills every quarter-note pulse.',
	15: 'The 2/4 pattern uses the stick hi-hat voice, although a separate pedal sample exists.',
	29: 'A single delayed piano-onset echo exists; no solo or multi-bar phrase response.',
	52: 'Fixed fills change kit voices, without motif orchestration transformations.',
	56: 'Time and commentary are combined, without a general limb model; swing hats use stick samples.',
	57: 'Some simultaneous-voice conflicts are suppressed, without general physical independence constraints.',
	61: 'Only commentary additions are limited to one voice per offset; the whole kit is not linear.',
	64: 'Section fills exist, without a target ensemble-hit or shared setup contract.',
	65: 'Piano onset catches exist, without shared strong-accent metadata.',
	69: 'Section-boundary fills exist, without an explicit 8-bar phrase hierarchy.',
	72: 'Individual voices may omit hits; no structural dropout/re-entry device.',
	77: 'Bass offbeat pickups can trigger kick responses; register and accent listening are absent.',
	79: 'Chorus intensity steps affect activity, without a planned multi-bar rise and release.',
	82: 'Crash probability grows across choruses, without the specified ride-to-full-kit trajectory.',
	83: 'Some commentary voices may be silent; no reasoned silence plan for the whole kit.'
};
const drumLines: Record<number, number> = { 1: 30, 2: 30, 3: 30, 5: 62, 7: 225, 13: 62, 15: 87, 19: 261, 21: 115, 22: 115, 25: 251, 29: 145, 32: 294, 37: 115, 38: 97, 40: 159, 41: 276, 42: 215, 45: 276, 46: 215, 47: 257, 52: 250, 58: 215, 59: 257, 60: 257, 61: 303, 64: 237, 65: 161, 67: 204, 68: 276, 69: 237, 70: 237, 72: 100, 76: 145, 77: 166, 79: 30, 82: 205, 83: 100, 84: 237 };

/** Expand the reviewed device decisions into one explicit row for every original ID. */
function deviceRows(prefix: 'P' | 'B' | 'D', count: number, implemented: number[], partial: Record<number, string>): MusicalityAudit[] {
	return Array.from({ length: count }, (_, index) => {
		const n = index + 1;
		const status: ImplementationStatus = implemented.includes(n) ? 'implemented' : partial[n] ? 'partial' : 'not-implemented';
		const evidence = prefix === 'P' ? n >= 16 && n <= 49 ? voicings : comp
			: prefix === 'B' ? [source('backing-bass', bassLines[n] ?? 191), test('backing-bass')]
				: [source('backing-drum-vocab', drumLines[n] ?? 30), source('backing-styles', 198), test('backing-drum-vocab')];
		return row(`${prefix}${n}`, status,
			status === 'implemented' ? 'The core device is reachable in the current accompaniment generator.'
				: status === 'partial' ? 'Related behavior is reachable, with the limitations below.'
					: 'No reachable implementation of this device was found in the audited generator.',
			partial[n] ?? (status === 'not-implemented' ? 'Add the device and its musical selection conditions, then verify integration and listening behavior.' : ''),
			evidence);
	});
}

const baselineAudit: MusicalityAudit[] = [
	...sections.map(([id, status, assessment, remaining, evidence]) => row(`S${id}`, status, assessment, remaining, evidence, 'Cross-cutting specification; individual device rows give narrower scope.')),
	...deviceRows('P', 58, pianoImplemented, pianoPartial),
	...deviceRows('B', 59, bassImplemented, bassPartial),
	...deviceRows('D', 85, drumsImplemented, drumsPartial)
];

const FOUNDATION_REVISION = 'dfa5421a6f198152595a094a11b7414e3d8d9d7c';
const CHECKPOINT_TIMING_REVISION = '19ab6bf3b23ae74fa35d4ae37c7993f1a2c4bad0';
const PIANO_BASS_DEVELOPMENT_REVISION = '7f6692f6ee29398d42ad083be1c73fa9c2b0c878';
const DRUM_DEVELOPMENT_REVISION = '546627edb29a9c5c6f356fbea0e6e3e2fa6cc260';
const foundationEvidence: MusicalityEvidence[] = [
	{ ...source('ensemble-plan'), revision: FOUNDATION_REVISION },
	{ ...source('backing-generation'), revision: FOUNDATION_REVISION },
	{ ...test('ensemble-plan'), revision: FOUNDATION_REVISION },
	{ ...test('backing-ensemble'), revision: FOUNDATION_REVISION }
];
const checkpointEvidence: MusicalityEvidence[] = [
	{ ...source('ensemble-plan'), revision: CHECKPOINT_TIMING_REVISION },
	{ ...test('ensemble-plan'), revision: CHECKPOINT_TIMING_REVISION },
	{ ...test('backing-ensemble'), revision: CHECKPOINT_TIMING_REVISION }
];
const phraseTimingEvidence: MusicalityEvidence[] = [
	{ ...source('ensemble-timing'), revision: CHECKPOINT_TIMING_REVISION },
	{ ...test('ensemble-timing'), revision: CHECKPOINT_TIMING_REVISION }
];
const formEvidence: MusicalityEvidence[] = [
	{ ...source('performance-form'), revision: FOUNDATION_REVISION },
	{ ...test('performance-form'), revision: FOUNDATION_REVISION }
];
const scriptedEvidence: MusicalityEvidence[] = [
	{ ...source('backing-lab-scenarios'), revision: FOUNDATION_REVISION },
	{ ...test('backing-lab-scenarios'), revision: FOUNDATION_REVISION }
];
const pianoDevelopmentEvidence: MusicalityEvidence[] = [
	{ ...source('backing-comp-figures'), revision: PIANO_BASS_DEVELOPMENT_REVISION },
	{ ...source('backing-generation'), revision: PIANO_BASS_DEVELOPMENT_REVISION },
	{ ...test('backing-comp-motifs'), revision: PIANO_BASS_DEVELOPMENT_REVISION }
];
const bassDevelopmentEvidence: MusicalityEvidence[] = [
	{ ...source('backing-bass-turnaround'), revision: PIANO_BASS_DEVELOPMENT_REVISION },
	{ ...source('backing-bass'), revision: PIANO_BASS_DEVELOPMENT_REVISION },
	{ ...test('backing-bass-turnaround'), revision: PIANO_BASS_DEVELOPMENT_REVISION }
];
const developmentEvidence: MusicalityEvidence[] = [
	...pianoDevelopmentEvidence, ...bassDevelopmentEvidence,
	{ ...test('backing-ensemble'), revision: PIANO_BASS_DEVELOPMENT_REVISION }
];
const drumDevelopmentEvidence: MusicalityEvidence[] = [
	{ ...source('backing-drum-phrases'), revision: DRUM_DEVELOPMENT_REVISION },
	{ ...source('backing-drum-vocab'), revision: DRUM_DEVELOPMENT_REVISION },
	{ ...source('backing-styles'), revision: DRUM_DEVELOPMENT_REVISION },
	{ ...source('backing-generation'), revision: DRUM_DEVELOPMENT_REVISION },
	{ ...test('backing-drum-phrases'), revision: DRUM_DEVELOPMENT_REVISION },
	{ ...test('backing-ensemble'), revision: DRUM_DEVELOPMENT_REVISION }
];
const observationEvidence: MusicalityEvidence[] = [
	{ ...source('solo-observer'), revision: 'd349207b31ebc944ece398c08570566e94a72acf' },
	{ ...source('solo-listener'), revision: 'd349207b31ebc944ece398c08570566e94a72acf' },
	{ kind: 'source', path: 'src/routes/diagnostics/backing-mixer/+page.svelte', revision: 'd349207b31ebc944ece398c08570566e94a72acf' },
	{ ...test('solo-observer'), revision: 'd349207b31ebc944ece398c08570566e94a72acf' },
	{ ...test('solo-listener'), revision: 'd349207b31ebc944ece398c08570566e94a72acf' },
	{ kind: 'test', path: 'tests/e2e/solo-listening.spec.ts', revision: 'd349207b31ebc944ece398c08570566e94a72acf' }
];

const rollingEvidence: MusicalityEvidence[] = [
	...['backing-rolling', 'backing-rolling-session', 'backing-rolling-renderer', 'backing-track', 'backing-drum-phrases'].map((file) => ({ ...source(file), revision: '99dcda41d394a46cf3013953223f8db536a2e737' })),
	...['backing-rolling', 'backing-rolling-session', 'backing-rolling-renderer', 'backing-drum-phrases-window'].map((file) => ({ ...test(file), revision: '99dcda41d394a46cf3013953223f8db536a2e737' })),
	{ kind: 'source', path: 'src/routes/diagnostics/backing-mixer/+page.svelte', revision: '99dcda41d394a46cf3013953223f8db536a2e737' },
	{ kind: 'test', path: 'tests/e2e/solo-listening.spec.ts', revision: '99dcda41d394a46cf3013953223f8db536a2e737' }
];

const crossLoopEvidence: MusicalityEvidence[] = [
	...['backing-rolling', 'backing-rolling-session', 'backing-rolling-renderer', 'solo-observer'].map((file) => ({ ...source(file), revision: 'musicality' })),
	...['backing-rolling-loop', 'backing-rolling-loop-session', 'solo-observer'].map((file) => ({ ...test(file), revision: 'musicality' })),
	{ kind: 'source', path: 'src/routes/diagnostics/backing-mixer/+page.svelte', revision: 'musicality' },
	{ kind: 'test', path: 'tests/e2e/solo-listening.spec.ts', revision: 'musicality' }
];

const bassSampleEvidence: MusicalityEvidence[] = [
	...['backing-bass-samples', 'backing-bass-instrument', 'backing-sample-loader'].map(file => ({ ...source(file), revision: 'musicality' })),
	...['backing-bass-samples', 'backing-bass-instrument'].map(file => ({ ...test(file), revision: 'musicality' })),
	{ kind: 'test', path: 'tests/e2e/backing-bass-selection.spec.ts', revision: 'musicality' }
];

const rootlessTextureEvidence: MusicalityEvidence[] = [
	...['ensemble-plan', 'coordinated-voicing', 'backing-generation', 'backing-rolling-piano', 'backing-rolling'].map(file => ({ ...source(file), revision: 'musicality' })),
	...['coordinated-rootless-texture', 'ensemble-rootless-texture', 'backing-rootless-texture-integration'].map(file => ({ ...test(file), revision: 'musicality' })),
	{ kind: 'source', path: 'src/lib/musicality/musician-decisions.ts', revision: 'musicality' },
	{ kind: 'test', path: 'tests/unit/musicality/musician-decisions.test.ts', revision: 'musicality' }
];

const reciprocalFeedbackEvidence: MusicalityEvidence[] = [
	{ kind: 'source', path: 'src/lib/musicality/listening-player.ts', revision: 'musicality' },
	{ kind: 'test', path: 'tests/unit/musicality/listening-causal-integration.test.ts', revision: 'musicality' },
	{ kind: 'test', path: 'tests/e2e/musicality-listening.spec.ts', revision: 'musicality' },
	...['backing-ensemble-feedback', 'backing-rolling', 'backing-generation', 'backing-rolling-take'].map(file => ({ ...source(file), revision: 'musicality' })),
	...['backing-drum-piano-feedback', 'backing-drum-piano-feedback-integration', 'backing-development-immutability'].map(file => ({ ...test(file), revision: 'musicality' })),
	{ kind: 'source', path: 'src/lib/musicality/musician-decisions.ts', revision: 'musicality' },
	{ kind: 'source', path: 'src/routes/diagnostics/backing-mixer/+page.svelte', revision: 'musicality' },
	{ kind: 'test', path: 'tests/e2e/solo-listening.spec.ts', revision: 'musicality' }
];

const causalVoicingEvidence: MusicalityEvidence[] = [
	...['coordinated-voicing', 'coordinated-voicing-family', 'backing-generation', 'backing-rolling-piano', 'backing-rolling'].map(file => ({ ...source(file), revision: 'musicality' })),
	...['coordinated-voicing', 'coordinated-voicing-family', 'backing-voicing-policy-integration', 'backing-voicing-causality'].map(file => ({ ...test(file), revision: 'musicality' })),
	{ kind: 'source', path: 'src/lib/musicality/musician-decisions.ts', revision: 'musicality' },
	{ kind: 'test', path: 'tests/unit/musicality/musician-decisions.test.ts', revision: 'musicality' }
];

const structuralTextureEvidence: MusicalityEvidence[] = [
	...['backing-bass-feel', 'backing-drum-phrases', 'backing-generation', 'backing-rolling'].map(file => ({ ...source(file), revision: 'musicality' })),
	...['backing-bass-feel', 'backing-drum-texture', 'backing-structural-texture'].map(file => ({ ...test(file), revision: 'musicality' }))
];

/** Foundations delivered after the baseline audit; these do not imply listening acceptance. */
const foundationAssessments: Record<string, string> = {
	S1: 'Coordinated mode now plans phrase intention and player roles before generating notes.',
	S2: "Explicit form and head/solo context feed ensemble roles, energy, density and tension. A rolling take retains instrument and ensemble checkpoints across declared playback loops while accepting completed microphone evidence.",
	S4: 'Coordinated mode layers bounded shared phrase motion, stable player placement and small event residuals over the existing tempo-aware swing grid. Sample-attack calibration separately removes the pedal lead-in and restores ten documented piano sample start offsets; the bass recordings need no timing trim.',
	S3: 'Coordinated mode adds commentary budgets, turn-taking, reasoned silence and fill cooldowns. Explicit performed forms now supply restrained heads, solo build/peak/release and a returning-head energy contour before phrase choices.',
	S8: 'Explicit coordinated piano placement follows the previous emitted voicing, prioritizing legal guide-tone motion and exact common-note retention before register distance. Unplayed harmony does not update its memory. Fixed and rolling explicit-form playback share the same energy-aware family selection and native style biases. Swing/Straight/Bossa phrase top-note targets break ties only after the existing harmonic and movement priorities.',
	S10: "Qualified microphone density and rests can change upcoming piano attack budgets and selective response ownership during a rolling lab take. Explicit-form rolling piano can choose a one-bar breath after independent drum commentary; selected Swing/Straight fallback chords can instead become short replies with drummer commentary space.",
	S15: 'Existing note duration and velocity shaping now reaches source-defined Smolken velocity layers and round robins: one recording per note in the supported register instead of unintended stacked layers.',
	S16: 'Bass ornament activity follows the ensemble plan while its pulse remains protected. Eligible two-bar walking passages now plan a directional path into the root of an actual following chorus.',
	S17: 'The coordinated drummer develops ride cells across two to four bars and selected commentary motifs within shared budgets. It can answer the previous bar of emitted piano attacks while preserving timekeeping and agreed arrivals.',
	S12: 'Explicit coordinated Swing/Straight heads and returning heads now use bass two-feel, solos walk, selected head-to-solo transitions begin walking early, and quiet final phrases can return to two.',
	S18: 'Selected complete solo-peak phrases sustain ride-bell color, with a return to ride and no consecutive bell phrases. Coordinated ride phrases retain a skip-note cell, then repeat, vary or release it with modest velocity shaping while preserving quarter-note pulse.',
	S19: 'Coordinated mode uses a foot hi-hat on beats 2 and 4. Its decoded sample removes 40 ms of pedal-mechanism lead-in so the chick aligns with the cymbal pulse; the original mode retains its stick-hat pattern and existing offbeat accents.',
	S20: 'Selected snare cells now repeat, displace or change orchestration over a phrase. A recent emitted piano rhythm can supply the source for a drum answer.',
	S22: 'A remembered commentary rhythm can change between existing snare, cross-stick, kick and ride-bell voices; accepted gestures have explicit limb occupancy.',
	S23: 'Coordinated bars resolve coincident strokes by a fixed hand/foot assignment. Commentary and agreed accents replace conflicting ostinato strokes before the complete bar is exported.',
	S24: 'Explicit form metadata and shared setup/arrival reservations now supplement existing form punctuation.',
	S25: 'Shared response ownership and silence reasons constrain whole commentary cells. The drummer can retain and transform a rhythm from the previous bar of actual emitted piano attacks.',
	S26: 'Coordinated mode now assigns response ownership, suppresses competing commentary, protects bass time and reserves bass/drum arrivals.',
	S27: "The lab captures completed microphone bars as active, resting or unknown. Qualified density/rest evidence can drive upcoming uncommitted bars across selected loops during a bounded adaptive take, or a separate recorded-feature replay.",
	S28: "Completed density/rest observations can restrain future piano/drum commentary and bass ornament admission, or reserve a selective response during the same take. Missing or uncertain input retains a form-led accompaniment.",
	S31: 'The planner assigns multi-bar phrase intentions and instrument roles before realization. A whole-performance energy target now biases phrase choices and restraint budgets while qualified solo evidence retains priority.',
	S32: 'Coordinated notes share smooth phrase motion, player placement and smaller independent residuals. Bass/drum arrivals share an exact tick, and the lab exports phrase timing decisions.',
	S33: 'Explicit-form performance arcs now shape shared energy through heads, solo build/peak/release and the ending. Smaller phrase movement feeds existing dynamic, density and color weights, with native style ceilings retained.',
	S37: 'Shared budgets and response/fill cooldowns now address simultaneous busyness and repeated reactions.',
	S38: "Versioned JSON checkpoints retain ensemble cooldowns and arrivals, piano motif/voicing history, bass pitch history and accepted launches, drum phrase state and prior emitted piano onsets. Rolling realization resumes one absolute bar at a time across declared loops without resetting observation times or instrument history.",
	S39: 'Piano and drum motifs now develop through scoped repetition, displacement, shortening, orchestration and space. Later cells must fit their current bar; withheld material has an explicit reason and does not rewrite its earlier source.',
	S40: 'The plan represents reasoned piano/commentary silence. Reserved silent bars and accepted motif gaps constrain scheduled piano sustain and resumed attacks; bass and drum timekeeping continue.',
	S41: "Rolling generation adds one causal instrument window to the shared plan, validates it against the scheduling horizon, and publishes scheduled events and bleed evidence together. Scheduled attacks and releases remain fixed.",
	S42: 'Shared budgets and response/arrival reservations prevent some ensemble conflicts. The coordinated drum planner also resolves simultaneous hand/foot occupancy and exports the accepted bar.',
	S44: "Planner, instrument checkpoints, causal observations and rolling clock/lifecycle tests complement existing event and form checks. Adaptive exports retain committed windows, actual dispatch records, loop/source-bar identities and absolute observation receipt times.",
	S46: "Scripted and microphone scenarios exercise restraint and selective responses. Rolling tests cover immutable committed notes, checkpoint restoration, scheduling deadlines and stop/restart ownership.",
};
const foundationRemaining: Record<string, string> = {
	S2: "Indefinite looping, changing form during a take, richer register and motif listening, and general arrangement negotiation remain incomplete.",
	S4: 'Listening acceptance and explicit musical intent controls for timing remain incomplete; the original mode retains independent event jitter.',
	S8: 'Phrase targets do not compose a melody or avoid a soloist’s register. Quartal shapes retain their distinct structure; broader melodic development and human listening acceptance remain pending.',
	S10: "Solo phrase-end recognition, complete motif imitation and solo-register avoidance remain incomplete. Piano replies currently use one chord after an accepted independent drum phrase.",
	S15: 'Muted/dead notes, slides and other articulations still require distinct event/renderer support. Source velocity-curve opcodes remain unsupported; final bass balance and listening acceptance are pending.',
	S16: "Rolling bass retains pitch history and accepted following-chorus launches while adapting ornament admission. Declared repeat seams can be launch targets; the final loop remains terminal. Broader trajectories and listening acceptance remain incomplete.",
	S17: "Broader kit vocabulary, articulation lengths and musical acceptance remain incomplete. Rolling memory continues across declared loops; new motifs still follow phrase boundaries.",
	S12: 'Further bass time devices, solo-density-led feel negotiation and human listening acceptance remain incomplete.',
	S18: 'Bell color requires a complete eligible peak phrase; short peaks retain ride. Cymbal note-length control, deliberate metric/displacement devices and broader modern ride textures remain incomplete.',
	S19: 'Splash/barked hats, sustained hi-hat timekeeping textures and other vocabulary remain incomplete.',
	S20: 'Live solo motif recognition, solo phrase-end detection, rolls and grace-note articulations remain incomplete.',
	S22: 'Tom voices and a general orchestration/limb-transition model remain absent.',
	S23: 'The fixed assignment checks simultaneous strokes only; stick travel, recovery times, rolls and more flexible limb allocation remain incomplete. Shared arrivals can include a single piano catch in explicit Swing/Straight; a general arrangement-hit contract remains incomplete.',
	S24: 'Shared piano catches are scoped to explicit Swing/Straight. Native-style catches, structural dropout/re-entry and richer phrase-boundary hierarchy remain incomplete.',
	S25: "Explicit-form rolling piano can leave a breathing bar or, in selected Swing/Straight passages, reply with one chord while optional drums leave space. Fixed parity, complete motif imitation, dynamic/register following and deliberate whole-kit dropout remain incomplete.",
	S27: "Capture assumes headphones and fixed gain-dependent thresholds. Ambiguous or poorly covered input stays unknown. Acoustic calibration, source separation, MIDI and phrase/motif recognition remain incomplete.",
	S28: "Register and dynamics remain diagnostic observations. Solo-register avoidance, motif following and broad acoustic validation remain incomplete.",
	S32: 'Live timing adaptation and richer context-aware placement remain incomplete. The modest build/release timing bias and other bounds still need listening acceptance.',
	S33: 'Soloist-relative dynamics, remembered climax selection, broader piano texture development and structural dropout/re-entry remain incomplete. Common rootless chords now thin to three notes for support and qualified active-solo evidence, retaining their existing fuller shapes in eligible solo development. Bass feel and selected sustained bell textures now follow explicit form. The bass adapter now restores source velocity/round-robin selection; measured bank-specific compensation preserves reference levels, while source velocity curves and human balance review remain pending. The new finite-form contour needs human acceptance.',
	S38: "Checkpoints bind the same declared finite form, tempo and generation policy. Indefinite continuation, longer development and checkpoint migration across engine versions remain incomplete.",
	S39: 'Development stays within selected piano/drum phrases using the existing kit. Rolling drum-to-piano response creates space or places one short reply after a source offset; complete drum-motif imitation remains pending. Richer cross-phrase dialogue and live solo imitation remain incomplete. Declared loops retain instrument history without extending motifs beyond their phrase.',
	S40: "Rolling mode owns attacks and pitched releases within each bar and excludes unreserved two-bar piano fallback figures. Sample and room tails can remain audible after release. General full-ensemble silence and phrase recognition remain incomplete.",
	S42: 'There is still no general post-generation register, harmonic-substitution or ensemble collision resolver.',
	S44: 'The full ensemble/phrase metric suite and a fresh human listening acceptance pass remain to do.',
	S41: "Rolling mode supports finite coordinated 4/4 lab takes in swing, straight, bossa nova and ballad. Declared loops share one audio clock and checkpoint chain. Bossa keeps its clave and root–fifth pulse; ballad keeps pads, two-feel and a 0.6 energy ceiling. Their native patterns do not use swing motif transforms. Indefinite continuation, other meters and a general ensemble conflict resolver remain incomplete.",
	S46: "Complete the specification’s broader A–F matrix, varied acoustic capture conditions and human listening validation. Automated event/audio evidence does not establish musical acceptance.",
};

const drumDeviceUpdates: Record<string, [ImplementationStatus, string, string]> = {
	D1: ['partial', 'Coordinated ride time varies skip placement and velocity within a remembered two-to-four-bar phrase.', 'Cymbal note-length control remains absent; the renderer still uses its existing sample articulation.'],
	D7: ['implemented', 'Selected complete solo-peak phrases sustain bell timekeeping at higher energy, preserve quarter-note pulse and return to ride; consecutive bell phrases are excluded.', 'Scoped to explicit coordinated Swing/Straight. Short peaks, incomplete phrases, dense solo evidence at selection and quiet energy retain ordinary ride. Human listening acceptance remains pending.'],
	D4: ['implemented', 'The coordinated drummer retains a ride cell across two to four bars, with repetition, variation and release over its phrase.', 'Quarter-note time remains explicit. Broader ride textures, cross-phrase motif development and listening acceptance remain pending.'],
	D23: ['implemented', 'A named snare Charleston cell is available as a commentary motif source, subject to the current bar’s allowance.', 'Its reprises can be withheld for space, another response or a setup; listening acceptance remains pending.'],
	D24: ['implemented', 'An eighth-note displacement of the remembered snare Charleston produces its complementary and-of-1 / beat-3 rhythm as a complete commentary cell.', 'Available through motif displacement within the current phrase; a separate reverse-Charleston selection policy and listening acceptance remain pending.'],
	D27: ['implemented', 'A remembered commentary cell can return shifted by a beat or an eighth-note subdivision, admitted as a complete gesture.', 'This uses existing short cells within one phrase; live motif recognition and development beyond a phrase remain pending.'],
	D28: ['implemented', 'Selected commentary cells recur across a phrase through repetition, displacement, orchestration and reasoned gaps.', 'The source is a short vocabulary cell or recent emitted piano rhythm. Development across phrases or playback loops remains incomplete.'],
	D29: ['implemented', 'The previous bar’s emitted piano attack offsets can supply a remembered drum answer, subject to response ownership and the whole-cell allowance.', 'Limited to one or two beat/eighth-grid piano attacks; no live soloist imitation or reciprocal motif negotiation.'],
	D52: ['partial', 'A remembered commentary rhythm can distribute its attacks among existing snare, cross-stick, kick and ride-bell voices.', 'Tom voices and a general cross-drum orchestration model remain absent.'],
	D53: ['implemented', 'A repeated commentary rhythm can keep its attack offsets while changing its sound sources within the existing kit.', 'The available orchestration choices are limited; additional kit voices and listening acceptance remain pending.'],
	D56: ['partial', 'Ride time, foot hi-hat and commentary use separate fixed limbs, with coincident strokes resolved across the complete coordinated bar.', 'This checks simultaneous occupancy; it does not model stick travel, recovery times or more flexible hand allocation.'],
	D57: ['partial', 'Coordinated bars assign cymbals/stick hats, snare/cross-stick, kick and pedal hat to separate hands and feet before emission.', 'Physical credibility is limited to simultaneous occupancy. Stroke-rate limits, limb transitions and musical acceptance remain incomplete.'],
	D76: ['implemented', 'Alongside existing onset coupling, a previous bar of emitted piano rhythm can become a drum motif and develop across later bars.', 'Selected explicit rolling Swing/Straight piano chords can now answer independent drum commentary with drummer space. Complete reciprocal motif imitation and listening acceptance remain pending.']
};

export const MUSICALITY_AUDIT: MusicalityAudit[] = baselineAudit.map((entry) => {
	if (entry.id === 'S47') return {
		...entry, status: 'partial',
		assessment: 'The musicality studio plays complete curated and eligible local tune-book 4/4 forms: Original uses fixed playback; Coordinated uses causal rolling orchestration with audio-clock musician decisions, listening marks and committed-event exports. Local charts use the existing form builders and are checked for complete harmony and the 128-bar arrangement limit before playback. After a take, a bounded bar selector and existing marks revisit captured decisions without starting audio. Optional curated blind review locks matched inputs, requires two complete listens and ratings before reveal, and exports actual scores with the verdict. The advanced lab retains historical WAV comparison and adaptive capture/replay.',
		remaining: 'Recorded human acceptance across styles and varied real repertoire, local-chart blind comparisons, deliberately counterbalanced review sets and microphone-driven adaptation in the simple studio remain pending.',
		scope: 'Two curated 4/4 tunes plus eligible saved tune-book charts; concert transposition, one to four solo choruses within 128 total bars, rhythm section only. A regular 32-bar form fits one or two solos. No acceptance is inferred from decision text or tests.',
		evidence: [...entry.evidence, ...['listening-tunes', 'listening-library', 'listening-player', 'listening-review', 'musician-decisions', 'listening-comparison'].flatMap(name => [
			{ kind: 'source' as const, path: `src/lib/musicality/${name}.ts`, revision: 'musicality' },
			{ kind: 'test' as const, path: `tests/unit/musicality/${name}.test.ts`, revision: 'musicality' }
		]), { kind: 'test', path: 'tests/unit/musicality/listening-tunes-library.test.ts', revision: 'musicality' }, { kind: 'test', path: 'tests/unit/musicality/listening-tune-book-integration.test.ts', revision: 'musicality' }, { kind: 'test', path: 'tests/e2e/musicality-listening.spec.ts', revision: 'musicality' }, { kind: 'test', path: 'tests/e2e/musicality-comparison.spec.ts', revision: 'musicality' }]
	};
	const drumUpdate = drumDeviceUpdates[entry.id];
	if (drumUpdate) return {
		...entry, status: drumUpdate[0], assessment: drumUpdate[1], remaining: drumUpdate[2],
		scope: 'Coordinated swing/straight 4/4 listening-lab preview; current kit and complete cells within the performed harmony. Original practice generation is unchanged.',
		evidence: [...entry.evidence, ...drumDevelopmentEvidence, ...(entry.id === 'D7' ? structuralTextureEvidence : [])]
	};
	if (entry.id === 'P4') return {
		...entry,
		assessment: 'The original displaced figure is supplemented by motif transformations; shifting a Charleston source by an eighth can produce the specified and-of-1 / beat-3 shape.',
		remaining: 'The shape is available through selected motif displacement, without a separate reverse-Charleston selection policy or dedicated listening acceptance.',
		scope: 'Existing swing figures plus coordinated swing/straight 4/4 piano motifs in the listening lab.',
		evidence: [...entry.evidence, ...pianoDevelopmentEvidence]
	};
	if (entry.id === 'P31' || entry.id === 'P35') return {
		...entry, status: 'partial',
		assessment: entry.id === 'P31'
			? 'The shared causal piano resolver explicitly favors exact common notes from the previous emitted chord, after minimizing eligible defining-tone motion. Rests do not introduce phantom voice-leading steps.'
			: 'Eligible selected voicing families use legal thirds and sevenths (or the chord’s sixth/suspension/triad roles) to minimize motion from the previous emitted harmony; bounded inversions make smooth ii–V–I lines reachable.',
		remaining: 'The objective stays within the selected family and current chord. Quartal shapes retain their fourth-stack character and do not claim a guide-tone objective. P36 describes the scoped Swing/Straight/Bossa phrase target; a composed melodic line and human listening acceptance remain pending.',
		scope: 'Explicit-form Coordinated 4/4 playback in all four styles; native rhythms and family biases retained. Original and metadata-free paths unchanged.',
		evidence: [...entry.evidence, ...causalVoicingEvidence]
	};
	if (entry.id === 'P36') return {
		...entry, status: 'partial',
		assessment: 'A phrase target anchored to the last emitted piano top guides legal inversions only after guide-tone motion, common-note retention and total movement tie. Solo builds request a small rise; releases and returning heads request settling. The live view distinguishes the target from the actual emitted top.',
		remaining: 'Targets are bounded placement preferences, not a composed melody or guaranteed ascent/descent. Guide and quartal families retain their placement rules. Broader melodic development, solo-register avoidance and human listening acceptance remain pending.',
		scope: 'Explicit-form Coordinated Swing/Straight/Bossa 4/4, fixed and rolling playback. Bossa keeps its native rhythm and voicing families. Original, metadata-free and Ballad paths retain their existing policies.',
		evidence: [...entry.evidence, ...causalVoicingEvidence,
			{ ...source('backing-piano-contour'), revision: 'musicality' },
			{ ...test('backing-piano-contour'), revision: 'musicality' },
			{ ...test('backing-piano-contour-integration'), revision: 'musicality' },
			{ ...test('backing-bossa-contour'), revision: 'musicality' },
			{ ...test('backing-bossa-contour-integration'), revision: 'musicality' }]
	};
	if (entry.id === 'P12' || entry.id === 'P13') return {
		...entry, status: 'implemented',
		assessment: entry.id === 'P12'
			? 'Selected four-bar phrases reuse a source rhythm from the existing figure library, with repetition, displacement, shortening and deliberate gaps.'
			: 'A remembered piano rhythm can return two bars later shifted by a beat or an eighth-note subdivision, retaining the complete cell when it fits.',
		remaining: 'Each later cell is admitted against its current bar, with a reason when withheld. This is within-phrase piano development; live solo motif imitation, development beyond a phrase and listening acceptance remain pending.',
		scope: 'Coordinated swing/straight 4/4 listening-lab preview; selected complete four-bar phrases. Original practice generation is unchanged.',
		evidence: [...entry.evidence, ...pianoDevelopmentEvidence]
	};
	if (entry.id === 'B2' || entry.id === 'B5') return {
		...entry, status: entry.id === 'B2' ? 'partial' : 'implemented',
		assessment: 'Explicit heads and returning heads use two-feel; solos walk. Selected two-bar head-to-solo transitions anticipate the declared arrival, and quiet final phrases can return to two. Fixed and rolling playback share the policy.',
		remaining: 'Harmonic changes may add attacks, and already committed launches retain their path. Density-led feel negotiation and human listening acceptance remain pending.',
		scope: 'Explicit coordinated Swing/Straight 4/4 forms. Original, metadata-free accompaniment and native Bossa/Ballad patterns retain their existing policies.',
		evidence: [...entry.evidence, ...structuralTextureEvidence]
	};
	if (entry.id === 'B59') return {
		...entry, status: 'implemented',
		assessment: 'Eligible final two-bar walking passages plan a bounded directional line into an actual following chorus, retaining the root octave selected by the existing register arc.',
		remaining: 'Requires two walking bars, aligned harmonic segment boundaries and a compatible role at the launch. Unsupported or conflicting opportunities keep the existing line and record why; the final declared loop ends without a further target. General long-wave walking and listening acceptance remain pending.',
		scope: 'Coordinated swing/straight 4/4 listening-lab preview with explicit consecutive chorus metadata and a following harmony. No forced two-feel change.',
		evidence: [...entry.evidence, ...bassDevelopmentEvidence, ...crossLoopEvidence]
	};
	if (entry.id === 'B28') return {
		...entry,
		assessment: 'Selected walking changes continue a preceding step through the new chord into an existing two-note approach. Eligible chorus launches also connect their harmonic changes.',
		remaining: 'The new cell covers one free quarter in a four-beat segment before an enclosure or double-chromatic approach. General scalar lines, other segment lengths and human listening acceptance remain pending.',
		scope: 'Explicit Coordinated Swing/Straight 4/4, fixed and rolling. Existing targets, approach pitches and pulse remain intact; intervening ornaments and protected ensemble roles withhold the cell. Original, metadata-free, Bossa and Ballad retain their previous behavior.',
		evidence: [...entry.evidence, ...bassDevelopmentEvidence,
			{ ...source('backing-bass-continuation'), revision: 'musicality' },
			{ ...test('backing-bass-continuation'), revision: 'musicality' },
			{ ...test('backing-bass-continuity-integration'), revision: 'musicality' }]
	};
	if (entry.id === 'D15') return {
		...entry, status: 'implemented',
		assessment: 'Coordinated mode uses the foot hi-hat sample on beats 2 and 4. Live playback and WAV bounce remove 40 ms of recorded pedal-mechanism lead-in before the chick, preserving the scheduled musical timing.',
		remaining: 'Human listening acceptance remains pending.', scope: 'Coordinated swing/straight listening-lab preview and existing ballad pedal time. Bossa retains stick hats; Original swing/straight retain their stick-hat voice.',
		evidence: [...entry.evidence, { ...source('backing-styles'), revision: FOUNDATION_REVISION }, { ...test('backing-ensemble'), revision: FOUNDATION_REVISION },
			{ ...source('backing-track'), revision: 'musicality' }, { ...test('backing-drum-samples'), revision: 'musicality' },
			{ kind: 'test', path: 'tests/e2e/backing-drum-timing.spec.ts', revision: 'musicality' }]
	};
	if (entry.id === 'D64') return {
		...entry,
		assessment: 'Coordinated mode reserves a preceding setup and a shared bass/drum arrival. Explicit Swing/Straight can admit one piano chord on the same tick when current silence and soloist priorities permit it.',
		remaining: 'Native Bossa/Ballad piano catches, multi-hit arrangement figures and human listening acceptance remain incomplete.',
		scope: 'Shared bass/drum arrivals in all four coordinated 4/4 styles; piano catches in explicit Swing/Straight only. Existing setup identity is preserved; qualified dense evidence, deliberate space and response recovery can withhold the piano.', evidence: [...entry.evidence, ...foundationEvidence,
			{ ...source('ensemble-plan'), revision: 'musicality' }, { ...source('backing-arrival'), revision: 'musicality' },
			{ ...test('backing-piano-arrivals'), revision: 'musicality' }, { ...test('backing-piano-arrival-integration'), revision: 'musicality' }]
	};
	if (entry.id === 'P55') return { ...entry, status: 'partial',
		assessment: 'A qualifying independent drum phrase can prompt a piano breath. Selected rolling Swing/Straight fallback chords in developing solo passages can instead become short replies with drummer commentary space. If that same drum motif returns in the following bar, the piano can leave one recovery bar, preserving protected roles and cooldowns.',
		remaining: 'Replies are limited to solo development and use a single rhythmic cue; peak phrases and complete motif imitation are outside this scope. Fixed offline parity and human listening acceptance remain incomplete. Bossa and Ballad retain their existing native behavior; Bossa currently has no qualifying optional commentary.',
		scope: 'Explicit-form Coordinated full-tune studio, blind comparison and rolling adaptive lab takes. Source hits must match accepted optional snare/cross-stick/kick events; timekeeping, setups and piano-derived drum answers do not trigger the response.',
		evidence: [...entry.evidence, ...reciprocalFeedbackEvidence,
			{ ...source('backing-piano-answer'), revision: 'musicality' },
			{ ...test('backing-piano-answer-integration'), revision: 'musicality' },
			{ ...source('backing-piano-recovery'), revision: 'musicality' },
			{ ...test('backing-piano-recovery'), revision: 'musicality' },
			{ ...test('backing-piano-recovery-integration'), revision: 'musicality' }] };
	if (entry.id === 'P19') return { ...entry, status: 'partial',
		assessment: 'Qualified dense solo evidence requests third-and-seventh support for already-permitted selected rootless A/B chords on maj7/min7/7. Existing silence and attack budgets remain authoritative; the musician view requires matching emitted notes and dense evidence before describing an actual reduction.',
		remaining: 'Other families and qualities retain their existing shapes. Default studio takes contain no solo observations. Broader sparse comping, solo-register avoidance and human full-tune listening acceptance remain pending.',
		scope: 'Explicit-form Coordinated 4/4 in all four styles with qualified dense evidence; fixed and causal rolling generation. Original, metadata-free and no-observation events remain unchanged.',
		evidence: [...entry.evidence, ...rootlessTextureEvidence, { ...test('coordinated-dense-texture'), revision: 'musicality' }, { ...test('backing-dense-piano-support-integration'), revision: 'musicality' }] };
	if (entry.id === 'P20') return { ...entry, status: 'partial',
		assessment: 'Selected rootless A/B chords use third, seventh and ninth (or thirteenth for dominant B) as three-note support. Explicit heads/releases/endings request support; qualified non-dense active-solo evidence overrides fuller development. P19 covers the two-note request under qualified dense activity.',
		remaining: 'Altered, diminished, suspended and sixth chords retain their existing vocabulary. Broader structural texture development and human listening acceptance remain pending.',
		scope: 'Explicit-form Coordinated 4/4 in all four styles, restricted to maj7/min7/7 and selected rootless A/B. Original and metadata-free generation remain unchanged.',
		evidence: [...entry.evidence, ...rootlessTextureEvidence] };
	if (entry.id === 'S35') return { ...entry, status: 'partial',
		assessment: 'All four styles now use shared 4/4 roles, silence budgets, phrase timing, causal adaptation and cross-loop planner memory. Native bossa clave/root–fifth and ballad pads/two-feel remain protected; straight uses motif development on even eighths.',
		remaining: 'Traditional/bebop/post-bop profiles, native bossa/ballad motif development and human listening acceptance remain incomplete.',
		scope: 'Coordinated listening-lab preview; Original practice remains available.',
		evidence: [...entry.evidence, { ...test('backing-style-coordination'), revision: 'musicality' }, { ...source('backing-rolling'), revision: 'musicality' }] };
	if (!foundationAssessments[entry.id]) return entry;
	return {
		...entry, status: 'partial', assessment: foundationAssessments[entry.id],
		remaining: foundationRemaining[entry.id] ?? 'Broader vocabulary, general ensemble conflict resolution and human listening acceptance remain incomplete.',
		scope: 'Shared planning, timing and rolling adaptation: swing, straight, bossa nova and ballad in 4/4. Motif transformations and walking launches: swing/straight only. Original generation remains the practice mode pending listening acceptance.',
		evidence: [
			...entry.evidence, ...foundationEvidence,
			...(['S15', 'S33', 'S44', 'S46'].includes(entry.id) ? bassSampleEvidence : []),
			...(['S8', 'S38', 'S44', 'S46'].includes(entry.id) ? causalVoicingEvidence : []),
			...(['S8', 'S33', 'S38', 'S44', 'S46'].includes(entry.id) ? rootlessTextureEvidence : []),
			...(['S10', 'S25', 'S26', 'S38', 'S40', 'S41', 'S44', 'S46'].includes(entry.id) ? reciprocalFeedbackEvidence : []),
			...(['S12', 'S18', 'S33', 'S38', 'S44', 'S46'].includes(entry.id) ? structuralTextureEvidence : []),
			{ ...test('backing-style-coordination'), revision: 'musicality' },
			...(['S2', 'S24', 'S44', 'S46'].includes(entry.id) ? formEvidence : []),
			...(['S4', 'S32', 'S44'].includes(entry.id) ? phraseTimingEvidence : []),
			...(['S4', 'S32', 'S44'].includes(entry.id) ? [
				{ ...source('backing-piano-samples'), revision: 'musicality' },
				{ ...test('backing-piano-samples'), revision: 'musicality' },
				{ kind: 'test' as const, path: 'tests/e2e/backing-pitched-timing.spec.ts', revision: 'musicality' }
			] : []),
			...(entry.id === 'S33' ? [{ kind: 'source' as const, path: 'documentation/contributing/backing-listening.md', revision: 'musicality' }] : []),
			...(['S3', 'S31', 'S33', 'S38', 'S44', 'S46'].includes(entry.id) ? [
				{ ...source('performance-energy'), revision: 'musicality' },
				{ ...source('ensemble-plan'), revision: 'musicality' },
				{ ...test('performance-energy'), revision: 'musicality' },
				{ ...test('backing-performance-arc'), revision: 'musicality' },
				{ kind: 'test' as const, path: 'tests/e2e/musicality-listening.spec.ts', revision: 'musicality' }
			] : []),
			...(['S2', 'S38', 'S41', 'S44', 'S46'].includes(entry.id) ? checkpointEvidence : []),
			...(['S27', 'S28', 'S44', 'S46'].includes(entry.id) ? scriptedEvidence : []),
			...(entry.id === 'S16' ? bassDevelopmentEvidence : []),
			...(['S39', 'S40'].includes(entry.id) ? pianoDevelopmentEvidence : []),
			...(['S38', 'S44', 'S46'].includes(entry.id) ? developmentEvidence : []),
			...(['S17', 'S18', 'S20', 'S22', 'S23', 'S25', 'S38', 'S39', 'S42', 'S44', 'S46'].includes(entry.id) ? drumDevelopmentEvidence : []),
			...(['S2', 'S10', 'S16', 'S17', 'S25', 'S27', 'S28', 'S44', 'S46'].includes(entry.id) ? observationEvidence : []),
			...(['S2', 'S10', 'S16', 'S17', 'S25', 'S27', 'S28', 'S38', 'S40', 'S41', 'S44', 'S46'].includes(entry.id) ? [...rollingEvidence, ...crossLoopEvidence] : []),
			...(entry.id === 'S40' ? [{ ...test('backing-ensemble-release'), revision: PIANO_BASS_DEVELOPMENT_REVISION }] : [])
		]
	};
});

/** Join the untouched specification to the separately reviewed evidence ledger. */
export function buildMusicalityRequirements(markdown: string): MusicalityRequirement[] {
	validateMusicalityManifest(markdown, MUSICALITY_AUDIT);
	const byId = new Map(MUSICALITY_AUDIT.map((entry) => [entry.id, entry]));
	return parseMusicalitySpec(markdown).map((entry) => ({ ...entry, ...byId.get(entry.id)! }));
}

/** Pin evidence links so later source movement cannot silently rewrite this audit. */
export function musicalityEvidenceUrl(evidence: MusicalityEvidence): string {
	return `https://github.com/avitus/mankunku/blob/${evidence.revision ?? MUSICALITY_AUDIT_REVISION}/${evidence.path}${evidence.line ? `#L${evidence.line}` : ''}`;
}
