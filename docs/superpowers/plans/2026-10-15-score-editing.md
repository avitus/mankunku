# Score editing — implementation plan

Design: [`../specs/2026-10-15-score-editing-design.md`](../specs/2026-10-15-score-editing-design.md). Each phase ships on its own to `dev`.

## Phase 1 — delete semantics
1. Pin the from-scratch entry flow (both editors) before touching code.
2. `buffer-ops.ts`: `replaceWithRest`, `removeTime`, `coalesceRests`, `stripTrailingRests`, `isLastElement` — test first, one op at a time.
3. `deleteSelectedNote` dispatch + `removeSelectedTime`; `loadFromPhrase` strips trailing rests; rewrite the note-delete pins.
4. `tuneDeleteSelected` / `tuneRemoveSelectedTime` / `removeTimeInSection` with the whole-bar rule and the lead-in guard; cursor set after the reload.
5. Routes: key bindings before the modifier early-returns; panel "Remove time"; tune rail status line; shortcut dialogs.
6. PDF-draft wipe: e2e reproduces, then the fix.
7. E2E for both editors; docs on the four surfaces; `npm run check`, `npm test`, the editor e2e specs; push to `dev`.

## Phase 2 — replace in place
`selectionMode`; `spliceElement` (overwrite) moved into buffer-ops; edit selections arm the cursor; replace/resize paths; duration sync; rewrite the four collision pins and the cursor-null pins; e2e "fix a wrong note".

## Phase 3 — navigation and pitch helpers
Alt+↑/↓ diatonic, Ctrl/Cmd+←/→ by bar, Home/End.

## Phase 4 — section time ops and review loop
Insert with push, cursor-mode split-with-tie, bar insert/delete, suspect bars on the chart, review state surviving navigation, editor tour.

## Phase 5 — range selection
Shift+arrows / Shift+click, range delete → rests, Ctrl/Cmd+Delete, copy/paste, R.
