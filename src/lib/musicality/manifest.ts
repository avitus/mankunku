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
const foundationEvidence: MusicalityEvidence[] = [
	{ ...source('ensemble-plan'), revision: FOUNDATION_REVISION },
	{ ...source('backing-generation'), revision: FOUNDATION_REVISION },
	{ ...test('ensemble-plan'), revision: FOUNDATION_REVISION },
	{ ...test('backing-ensemble'), revision: FOUNDATION_REVISION }
];
const checkpointEvidence: MusicalityEvidence[] = [
	{ ...source('ensemble-plan'), revision: 'musicality' },
	{ ...test('ensemble-plan'), revision: 'musicality' },
	{ ...test('backing-ensemble'), revision: 'musicality' }
];
const phraseTimingEvidence: MusicalityEvidence[] = [
	{ ...source('ensemble-timing'), revision: 'musicality' },
	{ ...test('ensemble-timing'), revision: 'musicality' }
];
const formEvidence: MusicalityEvidence[] = [
	{ ...source('performance-form'), revision: FOUNDATION_REVISION },
	{ ...test('performance-form'), revision: FOUNDATION_REVISION }
];
const scriptedEvidence: MusicalityEvidence[] = [
	{ ...source('backing-lab-scenarios'), revision: FOUNDATION_REVISION },
	{ ...test('backing-lab-scenarios'), revision: FOUNDATION_REVISION }
];

/** Foundations delivered after the baseline audit; these do not imply listening acceptance. */
const foundationAssessments: Record<string, string> = {
	S1: 'Coordinated mode now plans phrase intention and player roles before generating notes.',
	S2: 'Explicit performance sections, choruses and head/solo roles feed a shared immutable ensemble plan with energy, density and tension.',
	S4: 'Coordinated mode layers bounded shared phrase motion, stable player placement and small event residuals over the existing tempo-aware swing grid.',
	S3: 'Coordinated mode adds commentary budgets, turn-taking, reasoned silence and fill cooldowns to seeded weighted generation.',
	S10: 'The piano now follows shared role and attack budgets; scripted solo rests can reserve a response window.',
	S16: 'Bass ornament activity now follows the ensemble plan while its pulse remains protected.',
	S17: 'The coordinated drummer separates stable timekeeping from budgeted commentary and shared arrivals.',
	S19: 'Coordinated mode uses a foot hi-hat on beats 2 and 4; the original mode retains its stick-hat pattern and existing offbeat accents.',
	S23: 'Existing drum collision checks now work alongside a limited coordinated bass/drum setup-and-arrival contract.',
	S24: 'Explicit form metadata and shared setup/arrival reservations now supplement existing form punctuation.',
	S25: 'A shared response owner and silence reasons now constrain drum commentary; scripted observations can exercise this behavior.',
	S26: 'Coordinated mode now assigns response ownership, suppresses competing commentary, protects bass time and reserves bass/drum arrivals.',
	S27: 'A solo-feature input contract now feeds the planner. Dense and sparse scripted scenarios supply confidence, activity and rest observations in the lab; no solo audio is generated or analyzed.',
	S28: 'Fresh, confident scripted density/rest observations can shape responses; unavailable input is not treated as silence.',
	S31: 'The planner now assigns multi-bar phrase intentions and instrument roles before devices are realized.',
	S32: 'Coordinated notes share smooth phrase motion, player placement and smaller independent residuals. Bass/drum arrivals share an exact tick, and the lab exports phrase timing decisions.',
	S33: 'Build and release intentions now add modest phrase energy contours that feed existing dynamic and density weighting.',
	S37: 'Shared budgets and response/fill cooldowns now address simultaneous busyness and repeated reactions.',
	S38: 'Versioned JSON checkpoints retain phrase choice, response/fill cooldowns, pending arrivals, recent bar/phrase summaries and performance counters. Resuming a contiguous planning window reproduces a single-pass plan.',
	S40: 'The plan represents reasoned piano/commentary silence. Scheduled piano sustain ends at a reserved silent bar, and early timing offsets cannot resume inside that bar; bass and drum timekeeping continue.',
	S41: 'Coordinated generation now inserts a pure ensemble plan before device generation and returns a replayable decision trace.',
	S42: 'Pre-generation budgets and response/arrival reservations now prevent some ensemble conflicts before note generation.',
	S44: 'Planner, performance-form and integrated generated-event tests now complement the existing golden/report/listening infrastructure.',
	S46: 'New deterministic planner and integration tests exercise scripted dense/resting solo evidence, turn-taking, form and coordinated arrivals.'
};
const foundationRemaining: Record<string, string> = {
	S2: 'Live solo observations, richer motif/register memory and a rolling audio scheduler remain to build. Planner checkpoints are available; audio still renders a precomputed form.',
	S4: 'Listening acceptance and explicit musical intent controls for timing remain incomplete; the original mode retains independent event jitter.',
	S10: 'No live microphone adapter, motif imitation, solo-register avoidance or deliberate piano answer to a drum motif.',
	S16: 'Live soloist listening and planned two-bar turnaround trajectories are still absent.',
	S17: 'Multi-bar ride development, live solo listening and advanced drum devices remain incomplete.',
	S19: 'Splash/barked hats, sustained hi-hat timekeeping textures and other vocabulary remain incomplete.',
	S23: 'There is still no general limb model or arrangement-hit contract involving all three instruments.',
	S24: 'Piano participation in shared hits, structural dropout/re-entry and richer phrase-boundary hierarchy remain incomplete.',
	S25: 'Reciprocal motif dialogue, live solo listening and deliberate whole-kit dropout remain incomplete.',
	S27: 'A live microphone/MIDI observer, moving-window feature extraction, phrase detection, register/dynamic/motif analysis and bleed protection remain to build. Scripted input is not live listening.',
	S28: 'Scripted observations are not a live soloist model; register avoidance, dynamics and motif features remain absent.',
	S32: 'Live timing adaptation and richer context-aware placement remain incomplete. The modest build/release timing bias and other bounds still need listening acceptance.',
	S33: 'Soloist-relative dynamics, long-term peak/release development and richer timbral trajectories remain incomplete.',
	S38: 'Checkpoints resume only within the same declared form and tempo. Audio loops still repeat the precomputed timeline; rolling scheduling, cross-loop state and motif/device-family development remain incomplete.',
	S40: 'General duration-aware silence across every role and live phrase responses remain incomplete. Scheduled note release does not guarantee that sample and room-reverb tails are acoustically silent.',
	S42: 'There is still no general post-generation register, harmonic-substitution or ensemble collision resolver.',
	S44: 'The full ensemble/phrase metric suite and a fresh human listening acceptance pass remain to do.',
	S46: 'Complete the specification’s A–F scenarios, recorded/replayed live features and human listening validation.'
};

export const MUSICALITY_AUDIT: MusicalityAudit[] = baselineAudit.map((entry) => {
	if (entry.id === 'D15') return {
		...entry, status: 'implemented',
		assessment: 'Coordinated mode uses the foot hi-hat sample on beats 2 and 4.',
		remaining: '', scope: 'Coordinated swing 4/4 listening-lab preview. Original mode retains its stick-hat voice.',
		evidence: [...entry.evidence, { ...source('backing-styles'), revision: 'musicality' }, { ...test('backing-ensemble'), revision: 'musicality' }]
	};
	if (entry.id === 'D64') return {
		...entry,
		assessment: 'Coordinated mode reserves a preceding setup and a shared bass/drum arrival on a common tick.',
		remaining: 'Piano participation and a general arrangement-hit contract remain incomplete.',
		scope: 'Coordinated swing 4/4 listening-lab preview.', evidence: [...entry.evidence, ...foundationEvidence]
	};
	if (!foundationAssessments[entry.id]) return entry;
	return {
		...entry, status: 'partial', assessment: foundationAssessments[entry.id],
		remaining: foundationRemaining[entry.id] ?? 'The form is still precomputed. Live microphone listening, rolling scheduling and a general ensemble conflict resolver remain to build.',
		scope: 'Coordinated swing 4/4 in the listening lab; original generation remains the practice mode pending listening acceptance.',
		evidence: [
			...entry.evidence, ...foundationEvidence,
			...(['S2', 'S24', 'S44', 'S46'].includes(entry.id) ? formEvidence : []),
			...(['S4', 'S32', 'S44'].includes(entry.id) ? phraseTimingEvidence : []),
			...(['S2', 'S38', 'S41', 'S44', 'S46'].includes(entry.id) ? checkpointEvidence : []),
			...(['S27', 'S28', 'S44', 'S46'].includes(entry.id) ? scriptedEvidence : []),
			...(entry.id === 'S40' ? [{ ...test('backing-ensemble-release'), revision: 'musicality' }] : [])
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
