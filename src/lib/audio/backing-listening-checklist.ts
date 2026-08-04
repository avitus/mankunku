/**
 * The backing-track listening checklist — the single source of truth for
 * what a human listening pass evaluates. Rendered by the listening lab
 * (/diagnostics/backing-mixer) and referenced by
 * documentation/contributing/backing-listening.md; keeping the items here
 * means the doc and the UI cannot drift.
 *
 * Items encode the research targets behind the backing upgrade (tempo-
 * dependent swing, ensemble microtiming, comping vocabulary, drum form
 * awareness). A baseline audit is expected to FAIL several of them — that
 * is the point: each engine increment should flip specific items to pass.
 */

export type ChecklistSection = 'swing-feel' | 'bass' | 'comp' | 'drums' | 'ensemble' | 'mix';

export interface ListeningChecklistItem {
	id: string;
	section: ChecklistSection;
	prompt: string;
	/** What to listen for, concretely. */
	detail: string;
}

export const CHECKLIST_SECTION_LABELS: Record<ChecklistSection, string> = {
	'swing-feel': 'Swing feel',
	bass: 'Bass',
	comp: 'Comping',
	drums: 'Drums',
	ensemble: 'Ensemble',
	mix: 'Mix'
};

export const LISTENING_CHECKLIST: ListeningChecklistItem[] = [
	{
		id: 'swing-slow-wide',
		section: 'swing-feel',
		prompt: 'At 90 BPM the swing lopes — long-short is wide',
		detail: 'Slow tempi should sit near 3:1, clearly wider than triplets. A fixed 2:1 feel at 90 sounds stiff.'
	},
	{
		id: 'swing-medium-classic',
		section: 'swing-feel',
		prompt: 'At 160 BPM the swing is classic, around triplet feel',
		detail: 'Medium swing sits in the 2:1–2.5:1 zone; neither dotted-eighth stiff nor straight.'
	},
	{
		id: 'swing-fast-flattens',
		section: 'swing-feel',
		prompt: 'At 240 BPM the eighths flatten toward even',
		detail: 'Burning tempos should approach 1:1. Wide swing at 240 sounds like a drum machine.'
	},
	{
		id: 'timing-not-quantized',
		section: 'swing-feel',
		prompt: 'Instruments are not mutually quantized',
		detail: 'Bass/ride sit on top, comp lays back a touch; hits on the same beat are not sample-locked.'
	},
	{
		id: 'bass-no-machine-gun',
		section: 'bass',
		prompt: 'No machine-gun repeated notes',
		detail: 'The line never hammers one pitch three-plus quarters in a row (ghost dead-notes excepted).'
	},
	{
		id: 'bass-contour',
		section: 'bass',
		prompt: 'The line goes somewhere',
		detail: 'Over 4–8 bars the register rises/falls with intent instead of oscillating in a one-octave cell.'
	},
	{
		id: 'bass-announces-changes',
		section: 'bass',
		prompt: 'Chord changes are announced',
		detail: 'Approach notes lead into downbeats of new chords (chromatic/dominant/enclosure), not random jumps.'
	},
	{
		id: 'comp-no-loop',
		section: 'comp',
		prompt: 'Two minutes without hearing a loop',
		detail: 'Comping rhythm keeps varying; no figure repeats until it reads as a pattern.'
	},
	{
		id: 'comp-anticipates',
		section: 'comp',
		prompt: 'Pushes anticipate the next chord',
		detail: 'Off-beat hits before a barline sound the COMING harmony and tie across, early-on-purpose.'
	},
	{
		id: 'comp-space',
		section: 'comp',
		prompt: 'There is space',
		detail: 'Whole bars of rest happen; the comper is not filling every bar.'
	},
	{
		id: 'comp-voicing-variety',
		section: 'comp',
		prompt: 'Voicings vary in size and register',
		detail: 'Not the same four-note block all night: shells, rootless shapes, register shifts.'
	},
	{
		id: 'drums-ride-varies',
		section: 'drums',
		prompt: 'The ride pattern breathes',
		detail: 'Spang-a-lang varies (quarters-only bars, skip variations) without losing the time.'
	},
	{
		id: 'drums-feather-felt',
		section: 'drums',
		prompt: 'Feathered kick is felt, not heard',
		detail: 'Raise the kick slider to confirm it exists, restore it — at normal level it should disappear into the bass.'
	},
	{
		id: 'drums-fills-mark-form',
		section: 'drums',
		prompt: 'Fills and setups mark the form',
		detail: 'Activity clusters at 4/8-bar boundaries and section ends; never mid-phrase for no reason.'
	},
	{
		id: 'drums-no-doubling',
		section: 'drums',
		prompt: 'No synthesized metronome doubling the kit',
		detail: 'With metronome enabled, you hear ONE drummer — not the synth click layered on the sampled ride.'
	},
	{
		id: 'ensemble-arc',
		section: 'ensemble',
		prompt: 'The band goes somewhere across choruses',
		detail: 'On the 3-chorus AABA preset: later choruses are busier/stronger than the first.'
	},
	{
		id: 'ensemble-conversation',
		section: 'ensemble',
		prompt: 'Drums and comp converse',
		detail: 'Kick/snare accents relate to comp hits rather than ignoring them.'
	},
	{
		id: 'mix-balance',
		section: 'mix',
		prompt: 'Balance sits right at default sliders',
		detail: 'Bass warm but not booming, comp present but behind a soloist, kit crisp but supportive.'
	},
	{
		id: 'mix-kit-coherent',
		section: 'mix',
		prompt: 'The kit sounds like one instrument in one room',
		detail: 'Kick/snare/ride/hats read as a single drummer, not unrelated samples.'
	}
];

export type ChecklistVerdict = 'pass' | 'fail' | 'skip';

export interface ListeningReportMeta {
	presetLabel: string;
	style: string;
	tempo: number;
	seed: number;
	notes?: string;
}

/**
 * Render a markdown listening report for pasting into a PR or the
 * listening doc. Items without a verdict are listed as unchecked.
 */
export function buildListeningReport(
	meta: ListeningReportMeta,
	verdicts: Partial<Record<string, ChecklistVerdict>>
): string {
	const mark = (v: ChecklistVerdict | undefined): string =>
		v === 'pass' ? '✅' : v === 'fail' ? '❌' : v === 'skip' ? '➖' : '⬜';

	const lines: string[] = [
		`### Listening report — ${meta.presetLabel}`,
		`Style: ${meta.style} · Tempo: ${meta.tempo} BPM · Seed: ${meta.seed}`,
		''
	];
	const sections = [...new Set(LISTENING_CHECKLIST.map((i) => i.section))];
	for (const section of sections) {
		lines.push(`**${CHECKLIST_SECTION_LABELS[section]}**`);
		for (const item of LISTENING_CHECKLIST.filter((i) => i.section === section)) {
			lines.push(`- ${mark(verdicts[item.id])} ${item.prompt}`);
		}
		lines.push('');
	}
	if (meta.notes?.trim()) {
		lines.push('**Notes**', meta.notes.trim(), '');
	}
	return lines.join('\n');
}
