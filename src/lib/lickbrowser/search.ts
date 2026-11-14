import type { Excerpt, Solo, MetricNote } from "./types";
import { coversProgression } from "./rhythm";
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
/** Normalize user and Weimar chord spellings into comparable families. */
export function parseChord(raw: string) {
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
  let family = /^(m7b5|min7b5|-7b5)/.test(q)
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
/** Parse a bounded concert-pitch progression, rejecting unreadable symbols. */
export function parseQuery(text: string) {
  const tokens = text
    .trim()
    .split(/[\s|,→]+/)
    .filter(Boolean);
  if (!tokens.length || tokens.length > 12)
    throw Error("Enter between 1 and 12 chord symbols.");
  return tokens.map((t) => {
    const c = parseChord(t);
    if (!c) throw Error(`Could not read “${t}”. Try Dm7, G7, Cmaj7 or Bm7b5.`);
    return c;
  });
}
/** Spell a source chord in the requested concert key. */
export function displayChord(raw: string, shift = 0) {
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
  query: ReturnType<typeof parseQuery>,
  { transpose = true, artist = "" } = {},
) {
  const results = [];
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
