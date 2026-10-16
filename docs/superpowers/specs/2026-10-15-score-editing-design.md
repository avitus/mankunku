# Score Editing: Delete-to-Rest and In-Place Correction — Design

**Date:** 2026-10-15
**Status:** Approved (Andy, 2026-10-15, via plan review; MuseScore 4 named as the reference) — phases 1–3 shipped 2026-10-15, phase 4 2026-10-16

## Goal

Correcting an existing score — a PDF import above all — should work as well as entering one from scratch. Today both editors delete through one function that splices the element out and pulls every later note earlier; in the tune editor the pull stops at the hidden 4-bar page, so a hole opens at the page's end. Clicking a note clears the entry cursor, nothing can resize or re-pitch a selected element in place, and cursor entry refuses to overwrite a pitched note. The only correction loop is delete (shift) → re-type the rest of the page.

After this work: a note delete leaves a rest, the score stays on its beats, and a wrong note is fixed by clicking it and typing the right letter. Entering from scratch is byte-identical to today.

## The reference: MuseScore 4

From the handbook (`handbook.musescore.org`, basics/editing-notes-and-rests, basics/entering-notes-and-rests, basics/alternative-note-input-methods, navigation/navigating-your-score):

- Del replaces a note with a rest (single, list, or a range "with the correct rests according to the meter"). Rests "cannot normally be deleted completely" (voices 2–4 can).
- Ctrl/Cmd+Del = Tools → Remove selected range: removes the elements AND their time.
- Note input "will replace any rests or notes that were already present at the cursor location". Insert mode shifts later notes within the measure and grows it. Re-pitch mode changes pitches, keeps durations.
- Arrows move "one chord or rest at a time"; a single selection "acts as a cursor"; Ctrl+arrows move a measure. Up/Down = semitone, Alt+Shift+Up/Down = diatonic step, Ctrl+Up/Down = octave. The toolbar duration follows the selected note.

## Decisions and their rationale

1. **Delete on a note → a rest of the same duration at the same offset; the selection stays on it.** MuseScore's rule, and the one that keeps a complete score on its beats. Exception: the LAST element of the phrase/section is removed, as today — nothing follows it, and that is the append flow. "Before the end you edit in place; at the end you're entering." Tune editor corollary: when the resulting rest fills its whole bar the bar engraves as slashes, which carry no click anchor (2026-08-11: slash bars stay bar clicks), so the selection clears and the entry cursor parks at that bar's start.
2. **Delete on a rest → removes its time** (Andy's suggestion; MuseScore makes rests undeletable and uses Ctrl+Del). Section-scoped in the tune editor: every later note in the SECTION moves earlier, across pages; the section tail becomes silence; harmony never moves (chords belong to the form); never across sections. The pickup lead-in rest is refused with a hint — the Pickup control owns it, and removing its time would invalidate `pickupLength`.
3. **Ctrl/Cmd+Backspace or Ctrl/Cmd+Delete removes any element's time** (MuseScore's Ctrl+Del), with a "Remove time" panel button for touch.
4. **Two selection intents.** `entry` = the just-entered element; `edit` = a click or arrow landed here. Letters, `0`, `+` and the duration keys keep today's meaning on an entry selection or no selection; on an edit selection they act in place. Esc, → past the end, and any entry return to entry mode.
5. **Typing over an edit selection replaces it** with the current duration, pitched notes included — ONE overwrite policy, which reverses the 2026-07-26 "block on pitched collision" rule for cursor-mode entry and for append-mode roll/split onto an occupied page. Covered elements are dropped, a partially covered note is truncated (keeps its pitch, ties broken), bounded by the page window (overhang refused with a hint). Undo covers mistakes.
6. **Duration keys on an edit selection resize it in place** and set the current duration; selecting an element syncs the current duration to it when nameable. Click the first wrong note and type letters = MuseScore's Re-pitch; press a duration first to change the rhythm.
7. **Adjacent rests coalesce in the data** after an in-place edit: contiguous non-triplet rests whose starts fall in the same bar merge. One engraved rest ≈ one selectable element.
8. **A re-opened lick loads without its trailing pad rest.** Save always re-pads, so trailing silence is implied; the re-opened buffer has the shape of a fresh one and typing continues at once.
9. **Selection and cursor (tune editor).** An edit selection IS the position: `entryCursorPosition` reads it before the bar-click cursor and the page's append edge, and `tuneAddNote`/`tuneAddRest`/`tuneEnterTiedNote` hand an edit selection to step-entry's in-place paths. (Built this way in phase 2 rather than arming `entryCursor` on every selection, as first written: same observable behaviour, and the cursor-null pins stayed.) After a replace the following element is selected in edit intent, so successive letters re-pitch successive notes.

## Changes by module

### `src/lib/step-entry/buffer-ops.ts` (new, pure)
`replaceWithRest`, `removeTime`, `coalesceRests`, `stripTrailingRests`, `isLastElement`; phase 2 adds `spliceElement` (moved from tune-entry, collision `overwrite`).

### `src/lib/state/step-entry.svelte.ts`
`deleteSelectedNote` dispatches on the target's kind and position; `removeSelectedTime`; `loadFromPhrase` strips trailing rests. Phase 2: `selectionMode`, replace/resize paths, duration sync on select.

### `src/lib/state/tune-entry.svelte.ts`
`tuneDeleteSelected`, `tuneRemoveSelectedTime`, `removeTimeInSection` (section-scoped shift, lead-in guard, cursor set after the reload). Phase 2: edit selections arm the cursor; overwrite policy on cursor-mode entry and roll/split; straddlers trimmed at section level.

### Routes and panel
Backspace/Delete and Ctrl/Cmd+Backspace/Delete in both key handlers (bound before the modifier early-returns); `PitchEntryPanel` gains `onRemoveTime`; a rail status line in the tune editor; both shortcut dialogs.

### Docs
`documentation/user-guide.md`, `documentation/tunes.md`, `documentation/architecture/state-management.md`, `tune-system.md`, CLAUDE.md's step-entry paragraph.

## Phases

1. Delete semantics (decisions 1–3, 7–9 phase-1 half) + the PDF-draft wipe fix found on the way.
2. Replace in place (decisions 4–6, 9 phase-2 half).
3. Navigation and pitch helpers: Alt+↑/↓ diatonic, Ctrl/Cmd+←/→ by bar, Home/End.
4. Section-level time ops (insert, bar insert/delete, split-with-tie in cursor mode) and the import review loop (suspect bars on the chart, review state surviving navigation).
5. Range selection: Shift+arrows, range delete → rests, Ctrl/Cmd+Delete, copy/paste, R.

## Explicitly out of scope

Non-4/4 melody editing; voices; MuseScore's growing/irregular measures; persisting review state on the Tune; the lick editor's 4-bar cap (hidden, not lifted); anchoring whole-bar stored rests.

## Testing

TDD per project convention — failing tests first, in the existing suites:

- `tests/unit/step-entry/entry-flow-characterization.test.ts` (new): the from-scratch flow pinned BEFORE any change, green through phases 1–2.
- `tests/unit/step-entry/buffer-ops.test.ts` (new): every pure op.
- `tests/unit/step-entry/step-entry-selection.test.ts`: note-delete pins rewritten to delete-to-rest; rest-delete pins kept.
- `tests/unit/state/tune-entry-cursor.test.ts`: section-scoped removal across pages, whole-bar rule, lead-in guard; phase 2 rewrites the four collision pins and the cursor-null pins by name.
- e2e: `lick-editor-rests.spec.ts`, `tune-editor-entry.spec.ts` kept; new delete-to-rest specs in both editors; the PDF-draft round trip in `tune-pdf-import.spec.ts`.
