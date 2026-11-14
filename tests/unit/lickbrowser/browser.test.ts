import { describe, it, expect } from "vitest";
import { search, parseQuery } from "$lib/lickbrowser/search";
import { excerptPhrases } from "$lib/lickbrowser/phrase";
import { writtenNotes } from "$lib/lickbrowser/rhythm";
import { fitLickToRange } from "$lib/phrases/library-loader";
import { INSTRUMENTS } from "$lib/types/instruments";
import type { Solo } from "$lib/lickbrowser/types";
import corpus from "../../../static/data/weimar-licks.json";
const fixture = (tonicTick: number): Solo => ({
  melid: 1,
  performer: "Test",
  title: "Cadence",
  instrument: "ts",
  avgtempo: 120,
  notes: [0, 12, 24, 36, 48, 60, 72, 84, tonicTick].map((t) => [
    t / 24,
    0.25,
    84,
  ]),
  metric: [0, 12, 24, 36, 48, 60, 72, 84, tonicTick].map((t) => [t, 6, 3, 6]),
  changes: [
    [0, 1, 1, "D-7", 0],
    [2, 2, 1, "G7", 48],
    [4, 3, 1, "Cj7", 96],
    [8, null, null, null, 192],
  ],
  bars: [
    [0, "4/4", 1],
    [48, "4/4", 2],
    [96, "4/4", 3],
    [144, "4/4", 4],
    [192, "4/4", 5],
  ],
  beats: Array.from({ length: 17 }, (_, i) => i * 0.5),
});
describe("Native lick browser", () => {
  it("Rejects a tonic attack only in the second I bar", () => {
    expect(search([fixture(156)], parseQuery("Dm7 G7 Cmaj7"))).toHaveLength(0);
  });
  it("Clips to the first I bar and retains its attack in the native score", () => {
    const r = search([fixture(108)], parseQuery("Dm7 G7 Cmaj7"))[0];
    expect(r.notationEnd).toBe(144);
    const { score } = excerptPhrases(r, INSTRUMENTS["tenor-sax"], 68);
    expect(
      score.notes.some(
        (n) =>
          n.pitch !== null &&
          n.offset[0] / n.offset[1] >= 2 &&
          n.offset[0] / n.offset[1] < 3,
      ),
    ).toBe(true);
  });
  it.each(["tenor-sax", "alto-sax", "soprano-sax"] as const)(
    "Uses the shared comfort fit for %s and identical audio pitches",
    (id) => {
      const r = search([fixture(108)], parseQuery("Dm7 G7 Cmaj7"))[0];
      const instrument = INSTRUMENTS[id];
      const highest = instrument.concertRangeHigh - 5;
      const { score, performance } = excerptPhrases(r, instrument, highest);
      expect(score.notes.map((n) => n.pitch)).toEqual(
        performance.notes.map((n) => n.pitch),
      );
      expect(
        score.notes.every(
          (n) =>
            n.pitch !== null &&
            n.pitch >= instrument.concertRangeLow &&
            n.pitch <= highest,
        ),
      ).toBe(true);
      expect(fitLickToRange(score, instrument, highest).notes).toEqual(
        score.notes,
      );
    },
  );
  it("Restores short quarters without changing performed durations", () => {
    const r = search([fixture(108)], parseQuery("Dm7 G7 Cmaj7"))[0];
    expect(writtenNotes(r)[0][1]).toBe(12);
    const { score, performance } = excerptPhrases(
      r,
      INSTRUMENTS["tenor-sax"],
      68,
    );
    expect(score.notes[0].duration).toEqual([1, 4]);
    expect(
      performance.notes[0].duration[0] / performance.notes[0].duration[1],
    ).toBe(0.125);
  });
  it("Every real major cadence has a rendered attack in the FIRST I bar", () => {
    const found = search(
      corpus as unknown as Solo[],
      parseQuery("Dm7 G7 Cmaj7"),
    );
    expect(found.length).toBeGreaterThan(100);
    for (const r of found) {
      const tonic = r.chords.at(-1)!.tick;
      const tonicBar = r.bars.filter((b) => b[0] <= tonic).at(-1)!;
      const end = r.bars.find((b) => b[0] > tonic)?.[0] ?? tonicBar[0] + Number(tonicBar[1].split("/")[0]) * 12;
      const { score } = excerptPhrases(r, INSTRUMENTS["tenor-sax"], 68);
      const start = r.bars.filter((b) => b[0] <= r.notationStart).at(-1)?.[0] ?? r.notationStart;
      expect(
        score.notes.some(
          (n) =>
            n.pitch !== null &&
            (n.offset[0] / n.offset[1]) * 48 + start >= tonic &&
            (n.offset[0] / n.offset[1]) * 48 + start < end,
        ),
        r.id,
      ).toBe(true);
    }
  });
});
