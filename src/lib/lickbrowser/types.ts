/** Beat ticks are twelfths of a quarter; seconds retain the performed timing. */
export type MetricNote = [number, number, number, number, number?];
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
}
