# State Management

Mankunku uses **Svelte 5 runes** for reactive state management with localStorage persistence. There are four state modules, each a `.svelte.ts` file.

## State Modules

### Session State (`src/lib/state/session.svelte.ts`)

Holds the current practice session. **Not persisted** — resets on page reload.

```typescript
export const session = $state<{
  phrase: Phrase | null;
  engineState: AudioEngineState;
  tempo: number;
  isLoadingInstrument: boolean;
  micPermission: MicPermissionState;
  inputLevel: number;
  currentPitchMidi: number | null;
  currentPitchCents: number;
  currentClarity: number;
  isDetecting: boolean;
  isRecording: boolean;
  recordedNotes: DetectedNote[];
  lastScore: Score | null;
}>();
```

This module is purely a reactive container — no persistence, no methods. UI components and the practice page read/write fields directly.

### Settings State (`src/lib/state/settings.svelte.ts`)

User preferences. **Persisted** to localStorage under key `mankunku:settings`.

```typescript
const defaultSettings = {
  instrumentId: 'tenor-sax',
  defaultTempo: 100,
  metronomeEnabled: true,
  metronomeVolume: 0.7,
  swing: 0.5,
  theme: 'dark' as 'dark' | 'light',
  onboardingComplete: false,
  tonalityOverride: null             // Tonality | null
};
export const settings = $state(loadSettings());
```

**Key functions:**
- `saveSettings()` — Serialize to localStorage
- `getInstrument()` — Returns the `InstrumentConfig` for the current `instrumentId`
- `applyTheme()` — Toggles `.light` class on `<html>` based on `settings.theme`

Settings are loaded on module initialization with a merge strategy: saved values override defaults, but new default keys are preserved for forward compatibility.

### Progress State (`src/lib/state/progress.svelte.ts`)

Session history, adaptive difficulty, and per-category/per-key stats. **Persisted** to localStorage under key `mankunku:progress`.

```typescript
export const progress = $state<UserProgress>(loadProgress());
```

**Key functions:**
- `recordAttempt(phraseId, phraseName, category, key, tempo, level, score, scaleType)` — Records a session, updates adaptive state, category/key progress, and streak. Auto-saves.
- `getRecentSessions(count)` — Returns most recent sessions
- `getCategoryStats()` — Returns category progress sorted by attempt count
- `resetProgress()` — Destructive reset to initial state

Session history is bounded to 200 entries (oldest trimmed on insert).

**Streak tracking:** Compares `lastPracticeDate` to today's ISO date string. If yesterday → increment streak; if not today and not yesterday → reset to 1.

### Library State (`src/lib/state/library.svelte.ts`)

Filter state for the lick library browser. **Not persisted.**

```typescript
export const library = $state<{
  categoryFilter: PhraseCategory | null;
  difficultyFilter: number | null;
  searchQuery: string;
  selectedKey: PitchClass;
}>();
```

## Persistence Layer (`src/lib/persistence/storage.ts`)

Thin wrapper around `localStorage` with JSON serialization:

- All keys prefixed with `mankunku:` to avoid collisions
- `save<T>(key, value)` — `JSON.stringify` + `setItem`
- `load<T>(key)` — `getItem` + `JSON.parse`, returns `null` on missing/invalid
- `remove(key)` — Remove a single key
- `listKeys()` — All mankunku-prefixed keys
- `clearAll()` — Remove all mankunku data

Error handling: `save` warns on failure (e.g., quota exceeded), `load` returns `null` on parse errors.

## Pattern: Reactive State + Manual Save

Unlike auto-saving stores, Mankunku uses **explicit save calls**. This avoids excessive writes during rapid state changes (e.g., real-time pitch detection updating `session.currentPitchMidi` at 60fps).

- **Session**: Never persisted (ephemeral per-visit data)
- **Settings**: Saved on each user action (e.g., changing instrument, toggling metronome)
- **Progress**: Saved after each completed attempt via `recordAttempt()`
- **Library**: Never persisted (filter state resets on navigation)

## Svelte 5 Runes Pattern

All state uses the `$state` rune at module scope:

```typescript
// Module-level reactive state
export const myState = $state({ count: 0 });

// Components can read and write directly
myState.count++;  // triggers reactivity
```

Components use `$derived` for computed values:

```typescript
const displayLevel = $derived(xpToDisplayLevel(progress.adaptive.xp));
```

And `$props` for component inputs:

```typescript
interface Props { phrase: Phrase; }
let { phrase }: Props = $props();
```

This is simpler than Svelte 4's writable/derived stores and provides fine-grained reactivity without subscriptions.
