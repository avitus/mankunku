import type { Phrase, ChordQuality } from "$lib/types/music";
import { PITCH_CLASSES } from "$lib/types/music";
import type { InstrumentConfig } from "$lib/types/instruments";
import { fitLickToRange } from "$lib/phrases/library-loader";
import { reduceFraction } from "$lib/music/intervals";
import { writtenNotes } from "./rhythm";
import { parseChord } from "./search";
import type { Excerpt } from "./types";
const qualities: Record<string, ChordQuality> = {
  major: "maj7",
  minor: "min7",
  dominant: "7",
  "half-diminished": "min7b5",
  diminished: "dim7",
  augmented: "aug",
  suspended: "sus4",
};
/** Use one native range fit for both engraving and performed audio. */
export function excerptPhrases(
  r: Excerpt,
  instrument: InstrumentConfig,
  highest: number,
) {
  const start =
    r.bars.filter((b) => b[0] <= r.notationStart).at(-1)?.[0] ??
    r.notationStart;
  const last = parseChord(r.chords.at(-1)!.label)!;
  const base: Phrase = {
    id: r.id,
    name: `${r.performer} — ${r.title}`,
    key: PITCH_CLASSES[last.root],
    mode: last.family === "minor" ? "minor" : "major",
    timeSignature: [4, 4],
    category: "user",
    source: "Weimar Jazz Database",
    tags: [],
    difficulty: {
      level: 50,
      pitchComplexity: 50,
      rhythmComplexity: 50,
      lengthBars: Math.ceil((r.notationEnd - start) / 48),
    },
    notes: writtenNotes(r).map(([at, dur, , pitch]) => ({
      pitch: Math.round(pitch),
      offset: reduceFraction(at - start, 48),
      duration: reduceFraction(dur, 48),
    })),
    harmony: r.chords.map((c, i) => {
      const parsed = parseChord(c.label)!;
      return {
        chord: {
          root: PITCH_CLASSES[parsed.root],
          quality: qualities[parsed.family],
        },
        symbol: c.label,
        scaleId: "",
        startOffset: reduceFraction(c.tick - start, 48),
        duration: reduceFraction(
          (r.chords[i + 1]?.tick ?? r.notationEnd) - c.tick,
          48,
        ),
      };
    }),
  };
  const meter = r.bars.filter((b) => b[0] <= start).at(-1)?.[1] ?? "4/4";
  base.timeSignature = meter.split("/").map(Number) as [number, number];
  const score = fitLickToRange(base, instrument, highest);
  const shift = (score.notes[0]?.pitch ?? 0) - (base.notes[0]?.pitch ?? 0);
  // The native player accepts fractional whole notes. At the source tempo,
  // these reproduce measured seconds, while the score retains written rhythm.
  const performance: Phrase = {
    ...score,
    notes: r.notes.map(([at, dur, pitch]) => ({
      pitch: Math.round(pitch) + shift,
      offset: reduceFraction(Math.round((at * r.tempo + (r.notationStart - start) * 5) * 1000), 240000),
      duration: reduceFraction(Math.max(1, Math.round(dur * r.tempo * 1000)), 240000),
    })),
  };
  return { score, performance };
}
