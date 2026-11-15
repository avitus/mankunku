import type { Mode } from "$lib/types/music";
/** Twelfths of a quarter: written onset, length, grid, pitch, raw length,
 * optional performed onset and release interpolated on the annotated beat map. */
export type MetricNote = [number, number, number, number, number?, number?, number?];
export interface Solo {
  melid: number;
  performer: string;
  title: string;
  instrument: string;
  avgtempo: number;
  notes: [number, number, number][];
  metric: ([number, number, number, number?] | null)[];
  changes: [number, number | null, number | null, string | null, number][];
  bars: [number, string, number][];
  beats: number[];
}
export interface Excerpt {
  id: string;
  sourceId: number;
  performer: string;
  title: string;
  instrument: string;
  tempo: number;
  start: number;
  end: number;
  bar: number | null;
  beat: number | null;
  shift: number;
  notes: [number, number, number][];
  notationNotes: MetricNote[];
  notationStart: number;
  notationEnd: number;
  bars: Solo["bars"];
  chords: { label: string; original: string; time: number; tick: number }[];
  /** Concert tonic pitch class (0 = C) when a catalog progression supplied it. */
  tonic?: number;
  /** The progression's mode, beside `tonic`. */
  mode?: Mode;
}
