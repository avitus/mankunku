/** The original specification and the reviewed implementation ledger have separate lives. */
export type ImplementationStatus = 'implemented' | 'partial' | 'not-implemented' | 'reference';
export type MusicalityInstrument = 'ensemble' | 'piano' | 'bass' | 'drums';

export interface SpecRequirement {
	id: string;
	title: string;
	kind: 'section' | 'device';
	instrument: MusicalityInstrument;
	sectionId: string;
	sectionTitle: string;
	/** Exact original requirement text, including its heading. */
	markdown: string;
}

export interface MusicalityEvidence {
	kind: 'source' | 'test' | 'listening';
	path: string;
	line?: number;
	label?: string;
	/** Omitted for the pinned baseline; new work names its review branch explicitly. */
	revision?: string;
}

export interface MusicalityAudit {
	id: string;
	status: ImplementationStatus;
	assessment: string;
	remaining: string;
	scope: string;
	evidence: MusicalityEvidence[];
	validation: {
		method: 'source-audit';
		listening: 'not-assessed';
	};
}

export type MusicalityRequirement = SpecRequirement & MusicalityAudit;

export const STATUS_LABELS: Record<ImplementationStatus, string> = {
	implemented: 'Implemented',
	partial: 'Partial',
	'not-implemented': 'Not implemented',
	reference: 'Reference / acceptance'
};

export const INSTRUMENT_LABELS: Record<MusicalityInstrument, string> = {
	ensemble: 'Ensemble & architecture', piano: 'Piano', bass: 'Bass', drums: 'Drums'
};

const EXPECTED_IDS = [
	...Array.from({ length: 50 }, (_, index) => `S${index + 1}`),
	...Array.from({ length: 58 }, (_, index) => `P${index + 1}`),
	...Array.from({ length: 59 }, (_, index) => `B${index + 1}`),
	...Array.from({ length: 85 }, (_, index) => `D${index + 1}`)
];

/** Parse numbered headings outside code fences; retain the source prose unchanged. */
export function parseMusicalitySpec(markdown: string): SpecRequirement[] {
	const lines = markdown.split('\n');
	const entries: Array<SpecRequirement & { start: number }> = [];
	let fenced = false;
	let sectionId = '';
	let sectionTitle = '';
	const seen = new Set<string>();
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
		if (fenced) continue;
		const section = line.match(/^# (\d+)\. (.+)$/);
		const device = line.match(/^#{2,3} ([PBD]\d+)\. (.+)$/);
		if (!section && !device) continue;
		const id = section ? `S${section[1]}` : device![1];
		const title = (section?.[2] ?? device![2]).trim();
		if (seen.has(id)) throw new Error(`Duplicate specification ID: ${id}`);
		seen.add(id);
		if (section) { sectionId = id; sectionTitle = title; }
		if (!sectionId) throw new Error(`Device ${id} has no parent section`);
		const sectionNumber = Number(sectionId.slice(1));
		const instrument: MusicalityInstrument = section
			? sectionNumber >= 5 && sectionNumber <= 10 ? 'piano'
				: sectionNumber >= 11 && sectionNumber <= 16 ? 'bass'
					: sectionNumber >= 17 && sectionNumber <= 25 ? 'drums' : 'ensemble'
			: id[0] === 'P' ? 'piano' : id[0] === 'B' ? 'bass' : 'drums';
		entries.push({ id, title, kind: section ? 'section' : 'device', instrument, sectionId, sectionTitle, markdown: '', start: index });
	}
	return entries.map((entry, index) => {
		const { start, ...requirement } = entry;
		return { ...requirement, markdown: lines.slice(start, entries[index + 1]?.start ?? lines.length).join('\n').trim() };
	});
}

/** Fail closed when the original IDs or reviewed audit coverage drift. */
export function validateMusicalityManifest(markdown: string, audit: readonly MusicalityAudit[]): void {
	const parsed = parseMusicalitySpec(markdown);
	const expected = new Set(EXPECTED_IDS);
	const specIds = new Set(parsed.map((entry) => entry.id));
	for (const id of expected) if (!specIds.has(id)) throw new Error(`Missing specification ID: ${id}`);
	for (const id of specIds) if (!expected.has(id)) throw new Error(`Unknown specification ID: ${id}`);
	const auditIds = new Set<string>();
	for (const entry of audit) {
		if (auditIds.has(entry.id)) throw new Error(`Duplicate audit ID: ${entry.id}`);
		if (!expected.has(entry.id)) throw new Error(`Unknown audit ID: ${entry.id}`);
		if (!Object.hasOwn(STATUS_LABELS, entry.status)) throw new Error(`Invalid status for ${entry.id}`);
		if (!entry.assessment.trim() || !entry.scope.trim() || entry.evidence.length === 0) throw new Error(`Incomplete audit evidence: ${entry.id}`);
		if (entry.status !== 'implemented' && !entry.remaining.trim()) throw new Error(`Missing qualification: ${entry.id}`);
		auditIds.add(entry.id);
	}
	for (const id of expected) if (!auditIds.has(id)) throw new Error(`Missing audit ID: ${id}`);
}

/** Combine filters; exact IDs take precedence over incidental text matches. */
export function filterMusicalityRequirements(
	entries: readonly MusicalityRequirement[],
	filters: { search?: string; instrument?: MusicalityInstrument | 'all'; status?: ImplementationStatus | 'all' } = {}
): MusicalityRequirement[] {
	const query = filters.search?.trim().toLowerCase() ?? '';
	const exactId = entries.some((entry) => entry.id.toLowerCase() === query);
	return entries.filter((entry) =>
		(!filters.instrument || filters.instrument === 'all' || entry.instrument === filters.instrument) &&
		(!filters.status || filters.status === 'all' || entry.status === filters.status) &&
		(!query || (exactId ? entry.id.toLowerCase() === query :
			`${entry.id} ${entry.title} ${entry.sectionTitle} ${entry.markdown} ${entry.assessment} ${entry.remaining}`.toLowerCase().includes(query)))
	);
}
