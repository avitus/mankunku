import { listKeys, load, remove, save } from './storage';

const PREFIX = 'lick-report-reset/';
const OBSERVED = 'lick-report-server-generation';

export interface ReportGeneration {
	generation: string;
	applied_order: number;
}

/** Separate keys let one tab acknowledge a reset without deleting another tab's request. */
export function pendingReportResets(): { id: string; order: number }[] {
	return listKeys().filter(key => key.startsWith(PREFIX))
		.map(key => ({ id: key.slice(PREFIX.length), order: load<number>(key) ?? 0 }))
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function persistReportReset(): void {
	const key = PREFIX + crypto.randomUUID();
	const order = (pendingReportResets().at(-1)?.order ?? 0) + 1;
	save(key, order);
	if (load<number>(key) !== order) throw new Error('Could not persist the practice report reset');
}

/** Snapshot once when practice starts. Legacy workouts precede the first reset. */
export function currentLickReportGeneration(): string | null {
	return pendingReportResets().at(-1)?.id ?? load<ReportGeneration>(OBSERVED)?.generation ?? null;
}

export function acknowledgeReportResets(server: ReportGeneration | null, sent: string[]): void {
	const previous = load<ReportGeneration>(OBSERVED);
	if (server && server.applied_order >= (previous?.applied_order ?? 0)) {
		save(OBSERVED, server);
		if ((load<ReportGeneration>(OBSERVED)?.applied_order ?? 0) < server.applied_order) {
			throw new Error('Could not persist the practice report generation');
		}
	}
	if (!server && sent.length) throw new Error('Practice report reset is still pending');
	for (const id of sent) remove(PREFIX + id);
}
