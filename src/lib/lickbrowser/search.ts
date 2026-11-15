import type { ChordQuality } from "$lib/types/music";
import type { Excerpt, Solo, MetricNote } from "./types";
import { coversProgression } from "./rhythm";
import { beatAtTime } from "$lib/music/beat-map";
const roots: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
export const names = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
/** The family a chord is compared by when matching a progression. */
export type ChordFamily =
  | "major"
  | "minor"
  | "dominant"
  | "half-diminished"
  | "diminished"
  | "augmented"
  | "suspended";
/** A chord read by `parseChord`: root pitch class, family, raw suffix, slash bass. */
export interface ParsedChord {
  root: number;
  family: ChordFamily;
  suffix: string;
  bass?: string;
}
/** Normalize user and Weimar chord spellings into comparable families. */
export function parseChord(raw: string): ParsedChord | null {
  const s = raw
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("Δ", "maj")
    .replaceAll("ø", "m7b5")
    .replaceAll("°", "dim");
  const m = s.match(/^([A-Ga-g])([#b]?)([^/]*)(?:\/([A-Ga-g][#b]?))?$/);
  if (!m) return null;
  const root =
    (roots[m[1].toUpperCase()] +
      (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) +
      12) %
    12;
  const q = m[3];
  if (
    !/^(?:(?:maj|Maj|M|j|min|m|-|dim|o|aug|\+|sus|alt)?[0-9#b]*(?:sus[24]?|alt)?(?:\([0-9#b,]+\))?)$/.test(
      q,
    )
  )
    return null;
  const family: ChordFamily = /^(m7b5|min7b5|-7b5)/.test(q)
    ? "half-diminished"
    : /^(dim|o)/.test(q)
      ? "diminished"
      : /sus/.test(q)
        ? "suspended"
        : /^(min|m(?!aj)|-)/.test(q)
          ? "minor"
          : /^(aug|\+)/.test(q)
            ? "augmented"
            : /^(maj|Maj|M|j)/.test(q)
              ? "major"
              : /^(7|9|11|13|alt)/.test(q)
                ? "dominant"
                : "major";
  return { root, family, suffix: q, bass: m[4] };
}
/**
 * The native `ChordQuality` a chord's suffix names, on the app's own
 * conventions (`chordSymbolToQuality`): a bare triad or a 6/9 voices as maj6,
 * one dominant alteration names its quality and two or more read as altered.
 * Weimar writes alterations after the degree (79b, 7911#), the app before.
 */
export function chordQuality(c: ParsedChord): ChordQuality {
  const s = c.suffix;
  switch (c.family) {
    case "half-diminished":
      return "min7b5";
    case "diminished":
      return /7/.test(s) ? "dim7" : "dim";
    case "suspended":
      return /sus2/.test(s) ? "sus2" : "sus4";
    case "augmented":
      return /\d/.test(s) ? "aug7" : "aug";
    case "minor":
      return /^(?:min|m|-)6/.test(s) ? "min6" : "min7";
    case "major":
      return /^(?:maj|Maj|M|j)?7/.test(s) || /^(?:maj|Maj|M|j)\d/.test(s) ? "maj7" : "maj6";
  }
  if (/alt/.test(s)) return "7alt";
  const alterations = (
    [
      [/9b|b9/, "7b9"],
      [/9#|#9/, "7#9"],
      [/11#|#11/, "7#11"],
      [/13b|b13/, "7b13"],
    ] as const
  ).filter(([pattern]) => pattern.test(s));
  if (alterations.length > 1) return "7alt";
  return alterations[0]?.[1] ?? "7";
}
/** Parse a bounded concert-pitch progression, rejecting unreadable symbols. */
export function parseQuery(text: string): ParsedChord[] {
  const tokens = text
    .trim()
    .split(/[\s|,→]+/)
    .filter(Boolean);
  if (!tokens.length || tokens.length > 12)
    throw Error("Enter between 1 and 12 chord symbols.");
  return tokens.map((t: string): ParsedChord => {
    const c = parseChord(t);
    if (!c) throw Error(`Could not read “${t}”. Try Dm7, G7, Cmaj7 or Bm7b5.`);
    return c;
  });
}
/** Spell a source chord in the requested concert key. */
export function displayChord(raw: string, shift: number = 0): string {
  const c = parseChord(raw);
  if (!c) return raw;
  return (
    names[(c.root + shift + 12) % 12] +
    c.suffix.replace(/^j/, "maj").replace(/^-/, "m").replace(/^o/, "dim") +
    (c.bass ? "/" + names[(parseChord(c.bass)!.root + shift + 12) % 12] : "")
  );
}
/** Find populated excerpts ending within the first bar of the final chord. */
export function search(
  solos: Solo[],
  query: ParsedChord[],
  { transpose = true, artist = "" }: { transpose?: boolean; artist?: string } = {},
): Excerpt[] {
  const results: Excerpt[] = [];
  for (const solo of solos) {
    if (artist && solo.performer !== artist) continue;
    for (let i = 0; i + query.length < solo.changes.length; i++) {
      const spans = solo.changes.slice(i, i + query.length),
        parsed = spans.map((c) => parseChord(c[3]!));
      if (parsed.some((c) => !c)) continue;
      let shift = (query[0].root - parsed[0]!.root + 12) % 12;
      if (!transpose && shift) continue;
      if (
        !parsed.every(
          (c, j) =>
            c!.family === query[j].family &&
            (c!.root + shift) % 12 === query[j].root,
        )
      )
        continue;
      if (shift > 6) shift -= 12;
      const start = spans[0][0];
      const lastTick = spans.at(-1)![4];
      // A repeated tonic chord can last several bars: only its FIRST bar counts.
      const firstTonicBarEnd =
        solo.bars.find((b) => b[0] > lastTick)?.[0] ??
        solo.changes[i + query.length][4];
      const endTick = Math.min(
        firstTonicBarEnd,
        solo.changes[i + query.length][4],
      );
      const end = solo.beats[endTick / 12] ?? solo.changes[i + query.length][0];
      const notes = solo.notes
        .filter((n) => n[0] >= start && n[0] < end && n[1] > 0)
        .map((n): [number, number, number] => [
          n[0] - start,
          Math.min(n[1], end - n[0]),
          n[2] + shift,
        ]);
      if (!notes.length || end <= start) continue;
      const notationNotes = solo.notes.flatMap((n, k): MetricNote[] =>
        n[0] >= start && n[0] < end && n[1] > 0 && solo.metric?.[k]
          ? [
              [
                solo.metric[k]![0],
                solo.metric[k]![1],
                solo.metric[k]![2],
                n[2] + shift,
                solo.metric[k]![3],
                (beatAtTime(solo.beats, n[0]) ?? solo.metric[k]![0] / 12) * 12,
                (beatAtTime(solo.beats, Math.min(end, n[0] + n[1])) ??
                  (solo.metric[k]![0] + (solo.metric[k]![3] ?? solo.metric[k]![1])) / 12) * 12,
              ],
            ]
          : [],
      );
      const candidate: Excerpt = {
        notationNotes,
        notationStart: spans[0][4],
        notationEnd: endTick,
        bars: solo.bars,
        id: solo.melid + "-" + i,
        performer: solo.performer,
        title: solo.title,
        instrument: solo.instrument,
        tempo: solo.avgtempo,
        start,
        end,
        bar: spans[0][1],
        beat: spans[0][2],
        shift,
        notes,
        chords: spans.map((c) => ({
          label: displayChord(c[3]!, shift),
          original: c[3]!,
          time: c[0] - start,
          tick: c[4],
        })),
        sourceId: solo.melid,
      };
      if (coversProgression(candidate)) results.push(candidate);
    }
  }
  return results;
}
