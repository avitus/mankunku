/** Blind listening evidence: matched inputs, two complete takes, ratings before reveal. */
import { harmonyDurationBeats, type BounceParams } from '$lib/audio/backing-bounce';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import type { ListeningSnapshot } from './listening-player';

export type ListeningComparisonLabel = 'A' | 'B';
export type ListeningComparisonPreference = ListeningComparisonLabel | 'tie';
export const LISTENING_COMPARISON_CRITERIA = [
 { id: 'groove', label: 'Groove', hint: 'How convincing and settled is the pulse?' },
 { id: 'harmonicClarity', label: 'Harmonic clarity', hint: 'How clearly does the band carry the changes?' },
 { id: 'space', label: 'Space', hint: 'Does the accompaniment leave useful room to play?' },
 { id: 'interaction', label: 'Interaction', hint: 'Do the musicians sound responsive to one another?' },
 { id: 'development', label: 'Development', hint: 'Do ideas develop across the complete tune?' },
 { id: 'formArrivals', label: 'Form arrivals', hint: 'Are section and chorus arrivals clear and musical?' },
 { id: 'fatigue', label: 'Listening ease', hint: 'Higher means less tiring over the complete tune.' }
] as const;
export type ListeningComparisonCriterion = typeof LISTENING_COMPARISON_CRITERIA[number]['id'];
export type ListeningComparisonRatings = Record<ListeningComparisonCriterion, number>;
export type ListeningComparisonInputs = Omit<BounceParams, 'orchestration'>;
type Arrangement = 'original' | 'coordinated';
export interface BlindListeningComparisonRecord {
 readonly version: 1;
 readonly revealed: true;
 readonly id: string;
 readonly createdAt: string;
 readonly revealedAt: string;
 readonly buildVersion: string;
 readonly inputs: ListeningComparisonInputs;
 readonly mapping: Record<ListeningComparisonLabel, Arrangement>;
 /** Full, captured completed snapshots retain actual event and decision traces. */
 readonly takes: Record<ListeningComparisonLabel, ListeningSnapshot>;
 readonly ratings: Record<ListeningComparisonLabel, ListeningComparisonRatings>;
 readonly preference: ListeningComparisonPreference;
 readonly notes: string;
}
export interface BlindListeningComparisonSnapshot {
 readonly id: string;
 readonly inputs: ListeningComparisonInputs;
 readonly completed: Record<ListeningComparisonLabel, boolean>;
 readonly ratings: Record<ListeningComparisonLabel, Partial<ListeningComparisonRatings>>;
 readonly preference: ListeningComparisonPreference | null;
 readonly notes: string;
 readonly canReveal: boolean;
 readonly record: BlindListeningComparisonRecord | null;
}
const labels = ['A', 'B'] as const;
const criterionIds = LISTENING_COMPARISON_CRITERIA.map(c => c.id);
const MAX_ARCHIVE_CHARACTERS = 8_000_000;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const validDate = (value: unknown): value is string => text(value, 40) && Number.isFinite(Date.parse(value));
const score = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 1 && value <= 5;
function freeze<T>(value: T): T {
 if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
 return value;
}
function canonical(value: unknown): string {
 return JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
function validRatings(value: unknown): value is ListeningComparisonRatings {
 return object(value) && criterionIds.every(id => score(value[id])) && Object.keys(value).length === criterionIds.length;
}
/** Bound archived trees and reject non-finite data before retaining any nested trace. */
function boundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): boolean {
 if (++budget.nodes > 250_000 || depth > 32) return false;
 if (value === null || value === undefined || typeof value === 'boolean') return true;
 if (typeof value === 'number') return Number.isFinite(value);
 if (typeof value === 'string') return value.length <= 10_000;
 if (Array.isArray(value)) return value.length <= 50_000 && value.every(item => boundedJson(item, depth + 1, budget));
 return object(value) && Object.keys(value).length <= 100 && Object.values(value).every(item => boundedJson(item, depth + 1, budget));
}
function validInputs(value: unknown): value is ListeningComparisonInputs {
 if (!object(value) || 'orchestration' in value || !object(value.phrase) || !boundedJson(value)) return false;
 // Original has no opt-in terminal arrangement, so this would not be a matched pair.
 if (value.ending !== undefined && value.ending !== 'continue') return false;
 const phrase = value.phrase;
 if (!text(phrase.id, 500) || !text(phrase.name, 500) || !Array.isArray(phrase.timeSignature) ||
  phrase.timeSignature[0] !== 4 || phrase.timeSignature[1] !== 4 || !Array.isArray(phrase.harmony) || !phrase.harmony.length ||
  !Array.isArray(phrase.notes) || !finite(value.tempo) || value.tempo < 40 || value.tempo > 240 ||
  !finite(value.swing) || value.swing < 0.5 || value.swing > 1 || !finite(value.volume) || value.volume < 0 || value.volume > 1 ||
  !['swing', 'straight', 'bossa-nova', 'ballad'].includes(String(value.style)) ||
  !['piano', 'organ'].includes(String(value.instrument)) || !object(value.mix)) return false;
 const mix = value.mix;
 if (!Object.keys(DEFAULT_BACKING_MIX).every(key => finite(mix[key]) && mix[key] >= 0 && mix[key] <= 3)) return false;
 for (const segment of phrase.harmony) {
  if (!object(segment) || !object(segment.chord) || !Array.isArray(segment.startOffset) || !Array.isArray(segment.duration)) return false;
  const start = segment.startOffset; const duration = segment.duration;
  if (start.length !== 2 || duration.length !== 2 || !start.every(finite) || !duration.every(finite) ||
   start[0] < 0 || start[1] <= 0 || duration[0] <= 0 || duration[1] <= 0) return false;
 }
 const extent = harmonyDurationBeats(phrase as unknown as BounceParams['phrase']);
 return Number.isFinite(extent) && extent > 0 && extent <= 2048;
}
function validGenerated(value: unknown, ppq: number, durationBeats: number): boolean {
 if (!object(value) || !boundedJson(value)) return false;
 const event = (item: unknown): item is Record<string, unknown> => object(item) && typeof item.time === 'string' && /^\d+i$/.test(item.time) &&
  Number.parseInt(item.time, 10) <= Math.ceil(durationBeats * ppq) && finite(item.absBeat) && item.absBeat >= 0 && item.absBeat <= durationBeats && finite(item.velocity);
 const note = (n: unknown) => finite(n) && Number.isInteger(n) && n >= 0 && n <= 127;
 const bass = value.bassEvents; const piano = value.compEvents; const drums = value.drumEvents;
 return Array.isArray(bass) && Array.isArray(piano) && Array.isArray(drums) &&
  bass.every(e => event(e) && note(e.midi) && finite(e.duration) && e.duration > 0 && e.duration <= 60 && (e.velocity as number) >= 0 && (e.velocity as number) <= 127) &&
  piano.every(e => event(e) && Array.isArray(e.notes) && e.notes.length > 0 && e.notes.length <= 32 && e.notes.every(note) && finite(e.duration) && e.duration > 0 && e.duration <= 60 && (e.velocity as number) >= 0 && (e.velocity as number) <= 127) &&
  drums.every(e => event(e) && ['kick','snare','crossstick','hihat','hihat-pedal','ride','ride-bell','crash'].includes(String(e.drum)) && (e.velocity as number) >= 0 && (e.velocity as number) <= 1);
}
/** New causal archives carry dispatch proof; old fixed archives remain readable. */
function validTakeProvenance(take: Record<string, unknown>, inputs: ListeningComparisonInputs, arrangement: Arrangement): boolean {
 const provenance = take.provenance;
 if (provenance === undefined) return true;
 if (!object(provenance)) return false;
 const bars = Math.ceil(harmonyDurationBeats(inputs.phrase) / 4);
 if (provenance.totalBars !== bars || provenance.committedBars !== bars ||
  provenance.committedThroughTick !== harmonyDurationBeats(inputs.phrase) * (take.ppq as number)) return false;
 if (provenance.engine === 'fixed') return true;
 if (provenance.engine !== 'causal-rolling' || arrangement !== 'coordinated' || provenance.sessionStatus !== 'complete' ||
  !text(provenance.sessionId, 200) || !text(provenance.fingerprint, 200_000) ||
  (take.audioTime as number) - (take.startAudioTime as number) < harmonyDurationBeats(inputs.phrase) * 60 / inputs.tempo + 2.5 - 1e-6 ||
  !Array.isArray(provenance.dispatches) || provenance.dispatches.length > 50_000 || !object(take.generated)) return false;
 const generated = take.generated;
 const plan = generated.ensemblePlan;
 if (!object(plan) || !Array.isArray(plan.bars) || plan.bars.length !== bars ||
  !plan.bars.every((bar, index) => object(bar) && bar.barIndex === index)) return false;
 const ticks = [...new Set([...(generated.bassEvents as { time: string }[]), ...(generated.compEvents as { time: string }[]),
  ...(generated.drumEvents as { time: string }[])].map(event => Number.parseInt(event.time, 10)))].sort((a, b) => a - b);
 return provenance.dispatches.length === ticks.length && provenance.dispatches.every((entry, index) => object(entry) &&
  entry.status === 'played' && entry.tick === ticks[index] && finite(entry.audioTime) &&
  Math.abs(entry.audioTime - ((take.startAudioTime as number) + ticks[index] * 60 / inputs.tempo / (take.ppq as number))) < 1e-6);
}
function completeTake(value: unknown, inputs: ListeningComparisonInputs, arrangement: Arrangement): value is ListeningSnapshot {
 if (!object(value) || value.status !== 'completed' || value.error !== null || !object(value.params) ||
  canonical(value.params) !== canonical({ ...inputs, orchestration: arrangement })) return false;
 const duration = harmonyDurationBeats(inputs.phrase);
 return finite(value.durationBeats) && Math.abs(value.durationBeats - duration) < 1e-6 &&
  finite(value.elapsedBeats) && Math.abs(value.elapsedBeats - duration) < 1e-6 &&
  finite(value.startAudioTime) && value.startAudioTime >= 0 && finite(value.audioTime) &&
  value.audioTime - value.startAudioTime >= duration * 60 / inputs.tempo - 1e-6 &&
  finite(value.ppq) && Number.isInteger(value.ppq) && value.ppq > 0 && value.ppq <= 100_000 &&
  value.barIndex === Math.ceil(duration / inputs.phrase.timeSignature[0]) - 1 && validGenerated(value.generated, value.ppq, duration) &&
  validTakeProvenance(value, inputs, arrangement);
}

/** Mapping stays outside the public snapshot until both complete, rated takes are locked. */
export function createBlindListeningComparison(input: BounceParams, options: {
 buildVersion: string; rng?: () => number; now?: () => string; id?: string;
}) {
 const { orchestration: _orchestration, ...captured } = structuredClone(input);
 if (!validInputs(captured) || !text(options.buildVersion, 200)) throw new Error('Invalid listening comparison inputs.');
 const inputs = freeze(captured);
 const buildVersion = options.buildVersion;
 const random = (options.rng ?? Math.random)();
 if (!finite(random) || random < 0 || random >= 1) throw new Error('Comparison random value must be in [0, 1).');
 const mapping: Record<ListeningComparisonLabel, Arrangement> = random < 0.5 ? { A: 'original', B: 'coordinated' } : { A: 'coordinated', B: 'original' };
 const now = options.now ?? (() => new Date().toISOString());
 const id = options.id ?? globalThis.crypto.randomUUID();
 const createdAt = now();
 if (!text(id, 200) || !validDate(createdAt)) throw new Error('Invalid comparison identity or date.');
 const takes: Partial<Record<ListeningComparisonLabel, ListeningSnapshot>> = {};
 const ratings: Record<ListeningComparisonLabel, Partial<ListeningComparisonRatings>> = { A: {}, B: {} };
 let preference: ListeningComparisonPreference | null = null;
 let notes = '';
 let record: BlindListeningComparisonRecord | null = null;
 const editable = () => { if (record) throw new Error('This comparison has already been revealed and locked.'); };
 const labelValid = (label: ListeningComparisonLabel) => { if (!labels.includes(label)) throw new Error('Choose take A or B.'); };
 const canReveal = () => labels.every(label => Boolean(takes[label]) && validRatings(ratings[label])) && preference !== null;
 return {
  paramsFor(label: ListeningComparisonLabel): BounceParams { labelValid(label); return { ...structuredClone(inputs), orchestration: mapping[label] }; },
  snapshot(): BlindListeningComparisonSnapshot {
   return freeze({ id, inputs, completed: { A: Boolean(takes.A), B: Boolean(takes.B) },
    ratings: structuredClone(ratings), preference, notes, canReveal: canReveal(), record });
  },
  recordPlayback(label: ListeningComparisonLabel, snapshot: ListeningSnapshot): boolean {
   labelValid(label);
   if (record || !completeTake(snapshot, inputs, mapping[label])) return false;
   takes[label] = freeze(structuredClone(snapshot)); return true;
  },
  rate(label: ListeningComparisonLabel, criterion: ListeningComparisonCriterion, value: number): void {
   editable(); labelValid(label);
   if (!takes[label]) throw new Error('Complete this take before rating it.');
   if (!criterionIds.includes(criterion) || !score(value)) throw new Error('Choose a whole-number rating from 1 to 5.');
   ratings[label][criterion] = value;
  },
  setPreference(value: ListeningComparisonPreference): void {
   editable();
   if (!takes.A || !takes.B) throw new Error('Complete both takes before choosing a preference.');
   if (!['A', 'B', 'tie'].includes(value)) throw new Error('Choose A, B or a tie.'); preference = value;
  },
  setNotes(value: string): void {
   editable(); if (typeof value !== 'string' || value.length > 5000) throw new Error('Comparison notes are limited to 5000 characters.'); notes = value;
  },
  reveal(): BlindListeningComparisonRecord {
   if (record) return record;
   if (!canReveal()) throw new Error('Complete both takes, rate every criterion and choose a preference before revealing.');
   const revealedAt = now();
   if (!validDate(revealedAt)) throw new Error('Invalid comparison reveal date.');
   record = freeze({ version: 1 as const, revealed: true as const, id, createdAt, revealedAt,
    buildVersion, inputs, mapping: { ...mapping },
    takes: { A: takes.A!, B: takes.B! }, ratings: structuredClone(ratings) as Record<ListeningComparisonLabel, ListeningComparisonRatings>,
    preference: preference!, notes });
   return record;
  }
 };
}

/** Serialize finalized evidence only. Invalid/incomplete records never enter the archive. */
export function serializeListeningComparison(record: BlindListeningComparisonRecord): string {
 const json = JSON.stringify(record);
 if (!restoreListeningComparison(json)) throw new Error('Only a valid revealed comparison can be exported.');
 return json;
}
/** Treat saved evidence as untrusted data; malformed or incomplete records are ignored. */
export function restoreListeningComparison(json: string): BlindListeningComparisonRecord | null {
 if (typeof json !== 'string' || json.length > MAX_ARCHIVE_CHARACTERS) return null;
 try {
  const value: unknown = JSON.parse(json);
  if (!object(value) || value.version !== 1 || value.revealed !== true || !text(value.id, 200) ||
   !text(value.buildVersion, 200) || !validDate(value.createdAt) || !validDate(value.revealedAt) ||
   typeof value.notes !== 'string' || value.notes.length > 5000 || !validInputs(value.inputs) ||
   !object(value.mapping) || !object(value.takes) || !object(value.ratings) || !['A','B','tie'].includes(String(value.preference))) return null;
  if (!['original','coordinated'].includes(String(value.mapping.A)) || !['original','coordinated'].includes(String(value.mapping.B)) || value.mapping.A === value.mapping.B) return null;
  for (const label of labels) {
   if (!validRatings(value.ratings[label]) || !completeTake(value.takes[label], value.inputs, value.mapping[label] as Arrangement)) return null;
  }
  return freeze(value as unknown as BlindListeningComparisonRecord);
 } catch { return null; }
}
