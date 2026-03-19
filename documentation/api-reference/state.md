# API Reference: State

Four reactive state modules using Svelte 5 `$state` rune at module scope.

**Source:** `src/lib/state/`, `src/lib/persistence/`

---

## session.svelte.ts

Current practice session state. **Not persisted** — resets on page reload.

### `session`

```typescript
export const session = $state<{
  phrase: Phrase | null;              // Current phrase being practiced
  engineState: AudioEngineState;     // 'uninitialized' | 'ready' | 'playing' | 'recording'
  tempo: number;                      // Current BPM
  isLoadingInstrument: boolean;       // SoundFont loading in progress
  micPermission: MicPermissionState;  // 'prompt' | 'granted' | 'denied' | 'unavailable'
  inputLevel: number;                 // Mic input level 0-1
  currentPitchMidi: number | null;    // Real-time detected MIDI note
  currentPitchCents: number;          // Real-time cents deviation
  currentClarity: number;            // Real-time detection clarity
  isDetecting: boolean;               // Pitch detection active
  isRecording: boolean;               // Recording in progress
  recordedNotes: DetectedNote[];      // Notes captured in current recording
  lastScore: Score | null;            // Score from most recent attempt
}>();
```

No exported functions — components read/write fields directly.

---

## settings.svelte.ts

User preferences. **Persisted** to localStorage under key `mankunku:settings`.

### `settings`

```typescript
export const settings = $state({
  instrumentId: 'tenor-sax',       // 'tenor-sax' | 'alto-sax' | 'trumpet'
  defaultTempo: 100,               // BPM
  metronomeEnabled: true,
  metronomeVolume: 0.7,            // 0-1
  swing: 0.5,                      // Swing ratio
  theme: 'dark' as 'dark' | 'light',
  onboardingComplete: false
});
```

### `saveSettings(): void`

Serialize current settings to localStorage. Call after any user-initiated change.

### `getInstrument(): InstrumentConfig`

Returns the `InstrumentConfig` for the current `instrumentId`. Falls back to tenor sax.

### `applyTheme(): void`

Toggles `.light` class on `<html>` based on `settings.theme`. No-op in SSR.

---

## progress.svelte.ts

Session history and adaptive difficulty. **Persisted** to localStorage under key `mankunku:progress`.

### `progress`

```typescript
export const progress = $state<UserProgress>({
  adaptive: AdaptiveState;               // Adaptive difficulty state
  sessions: SessionResult[];             // Session history (max 200)
  categoryProgress: Record<string, CategoryProgress>;
  keyProgress: Record<string, { attempts: number; averageScore: number }>;
  totalPracticeTime: number;
  streakDays: number;
  lastPracticeDate: string;              // ISO date string
});
```

### `recordAttempt(phraseId, category, key, tempo, difficultyLevel, score): void`

Record a completed attempt. This single function:
1. Creates a `SessionResult` and prepends to `sessions` (bounded to 200)
2. Updates adaptive state via `processAttempt()`
3. Updates category progress (running average, best score)
4. Updates key progress (running average)
5. Updates streak (compares to yesterday's date)
6. Auto-saves to localStorage

### `getRecentSessions(count?): SessionResult[]`

Returns the most recent `count` sessions (default 10), newest first.

### `getCategoryStats(): CategoryProgress[]`

Returns category progress sorted by attempt count (descending).

### `resetProgress(): void`

Destructive reset to initial state. Saves immediately.

### `saveProgress(): void`

Manual save to localStorage.

---

## library.svelte.ts

Filter state for the lick library browser. **Not persisted** — resets on navigation.

### `library`

```typescript
export const library = $state<{
  categoryFilter: PhraseCategory | null;  // null = show all
  difficultyFilter: number | null;        // null = show all
  searchQuery: string;
  selectedKey: PitchClass;                // Default 'C'
}>();
```

No exported functions — library page reads/writes fields directly.

---

## storage.ts

Thin localStorage wrapper with JSON serialization.

**Source:** `src/lib/persistence/storage.ts`

All keys are prefixed with `mankunku:` to avoid collisions.

| Function | Signature | Description |
|---|---|---|
| `save<T>` | `(key, value) → void` | `JSON.stringify` + `setItem`. Warns on failure (e.g. quota exceeded). |
| `load<T>` | `(key) → T \| null` | `getItem` + `JSON.parse`. Returns `null` on missing/invalid. |
| `remove` | `(key) → void` | Remove a single key |
| `listKeys` | `() → string[]` | All mankunku-prefixed keys (without prefix) |
| `clearAll` | `() → void` | Remove all mankunku data |
