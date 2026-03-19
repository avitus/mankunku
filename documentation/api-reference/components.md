# API Reference: Components

All Svelte components organized by domain. Each uses Svelte 5 `$props()` for inputs and `$derived`/`$effect` for reactivity.

**Source:** `src/lib/components/`

---

## Audio Components

### `MicStatus.svelte`

**Path:** `src/lib/components/audio/MicStatus.svelte`

Displays microphone status with an input level meter and permission request button.

| Prop | Type | Description |
|---|---|---|
| `permission` | `MicPermissionState` | Current mic permission state |
| `inputLevel` | `number` | Input level 0–1 |
| `onrequest` | `() => void` | Callback to request mic access |

**Behavior:**
- `granted` → Shows colored dot + "Mic active" + level meter bar (green/yellow/red)
- `prompt`/`denied` → Shows "Enable Mic" / "Retry Mic" button
- `unavailable` → Shows "No mic available"

### `PitchMeter.svelte`

**Path:** `src/lib/components/audio/PitchMeter.svelte`

Real-time pitch display with cents deviation meter and clarity bar.

| Prop | Type | Description |
|---|---|---|
| `midi` | `number \| null` | Current detected MIDI note |
| `cents` | `number` | Cents deviation (-50 to +50) |
| `clarity` | `number` | Detection clarity 0–1 |
| `active` | `boolean` | Whether detecting/recording |

**Display:**
- Note name in large text, colored by tuning accuracy
- Horizontal cents meter with center line and sliding indicator
- "flat" / "sharp" labels with numeric cents value
- Clarity progress bar (only when active)

**Tuning color thresholds:**
- <= 10 cents: green (success)
- <= 25 cents: yellow (warning)
- \> 25 cents: red (error)

### `TransportBar.svelte`

**Path:** `src/lib/components/audio/TransportBar.svelte`

Play/stop button, tempo slider, and metronome toggle.

| Prop | Type | Description |
|---|---|---|
| `isPlaying` | `boolean` | Playback active |
| `isLoading` | `boolean` | Instrument loading |
| `tempo` | `number` | Current BPM |
| `metronomeEnabled` | `boolean` | Metronome on/off |
| `onplay` | `() => void` | Play callback |
| `onstop` | `() => void` | Stop callback |
| `ontempochange` | `(tempo: number) => void` | Tempo change callback |
| `onmetronometoggle` | `() => void` | Metronome toggle callback |

**Tempo range:** 40–300 BPM. Disabled during playback.

---

## Notation Component

### `NotationDisplay.svelte`

**Path:** `src/lib/components/notation/NotationDisplay.svelte`

Renders sheet music from a `Phrase` using [abcjs](https://paulrosen.github.io/abcjs/).

| Prop | Type | Description |
|---|---|---|
| `phrase` | `Phrase \| null` | Phrase to render |
| `instrument` | `InstrumentConfig` | Optional; transposes to written pitch |

**Behavior:**
- Lazy-loads `abcjs` on mount
- Converts phrase to ABC notation via `phraseToAbc()`
- Renders to SVG with `abcjs.renderAbc()`
- Responsive rendering (`responsive: 'resize'`)
- Dark mode support: overrides SVG path/text colors via CSS

Shows "No phrase loaded" placeholder when `phrase` is null.

---

## Practice Components

### `PhraseInfo.svelte`

**Path:** `src/lib/components/practice/PhraseInfo.svelte`

Compact display of phrase metadata.

| Prop | Type | Description |
|---|---|---|
| `phrase` | `Phrase` | The phrase |

Shows: key, time signature, difficulty level, and chord symbols (derived from harmony).

### `FeedbackPanel.svelte`

**Path:** `src/lib/components/practice/FeedbackPanel.svelte`

Post-attempt scoring feedback with grade display and action buttons.

| Prop | Type | Description |
|---|---|---|
| `score` | `Score` | Score from the attempt |
| `onrepeat` | `() => void` | "Try Again" callback |
| `onnext` | `() => void` | "Next Phrase" callback |

**Layout:**
1. Large grade label with color (e.g. "Perfect" in green)
2. Overall percentage
3. Notes hit count (e.g. "6/8 notes hit")
4. Pitch/Rhythm breakdown with progress bars
5. `NoteComparison` grid
6. "Try Again" and "Next Phrase" buttons

### `NoteComparison.svelte`

**Path:** `src/lib/components/practice/NoteComparison.svelte`

Per-note comparison grid showing expected vs played notes.

| Prop | Type | Description |
|---|---|---|
| `noteResults` | `NoteResult[]` | Per-note scoring results |

Filters out extra notes (only shows matched and missed). Columns: index, expected note name, played note name (colored by accuracy), pitch %, rhythm %.

---

## Library Components

### `LickCard.svelte`

**Path:** `src/lib/components/library/LickCard.svelte`

Card displaying a curated lick's metadata.

| Prop | Type | Description |
|---|---|---|
| `lick` | `Phrase` | The lick |
| `onclick` | `() => void` | Optional click handler |

Shows: name, category label, difficulty level (color-coded), bar count, note count, tags (up to 4).

**Difficulty colors:**
- 1–2: green
- 3–4: blue (accent)
- 5–6: yellow (warning)
- 7+: red (error)

### `CategoryFilter.svelte`

**Path:** `src/lib/components/library/CategoryFilter.svelte`

Horizontal pill buttons for filtering by category.

| Prop | Type | Description |
|---|---|---|
| `categories` | `{ category: PhraseCategory; count: number }[]` | Available categories |
| `selected` | `PhraseCategory \| null` | Currently selected (null = all) |
| `onselect` | `(category: PhraseCategory \| null) => void` | Selection callback |

Includes an "All (N)" button plus one pill per category with count.

---

## Onboarding Component

### `Onboarding.svelte`

**Path:** `src/lib/components/onboarding/Onboarding.svelte`

Three-step first-run onboarding flow.

No props — reads/writes `settings` state directly.

**Steps:**
1. **Instrument** — Select from available instruments (tenor sax, alto sax, trumpet)
2. **Mic** — Request microphone permission (with "Skip for now" option)
3. **Ready** — Welcome message with "Start Practicing" and "Go to Dashboard" links

Completion sets `settings.onboardingComplete = true` and saves.
