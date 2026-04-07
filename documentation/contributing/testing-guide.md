# Testing Guide

Patterns, conventions, and guidance for writing tests in Mankunku.

## Setup

Tests use [Vitest](https://vitest.dev/) with the following configuration (from `vite.config.ts`):

```typescript
test: {
  include: ['tests/unit/**/*.test.ts'],
  environment: 'node',
  alias: {
    '$lib': './src/lib'
  }
}
```

### Running Tests

```bash
# Run all unit tests
npm run test:unit

# Watch mode
npx vitest

# Specific file
npx vitest tests/unit/audio/capture.test.ts

# With coverage
npx vitest --coverage
```

### Test File Location

Tests mirror the source structure under `tests/unit/`:

```
tests/
└── unit/
    ├── audio/
    │   └── capture.test.ts
    └── scoring/
        └── note-segmenter.test.ts
```

## Mocking Audio APIs

Browser audio APIs (`AudioContext`, `AnalyserNode`, `MediaStream`) don't exist in the Node test environment. Use mock factories.

### Mock AudioContext

```typescript
function createMockAudioContext() {
  return {
    createMediaStreamSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn()
    })),
    createAnalyser: vi.fn(() => createMockAnalyser()),
    sampleRate: 48000,
    currentTime: 0
  };
}
```

### Mock AnalyserNode

```typescript
function createMockAnalyser(fftSize = 4096) {
  const buffer = new Float32Array(fftSize);
  return {
    fftSize,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData: vi.fn((out: Float32Array) => {
      out.set(buffer);
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    context: { sampleRate: 48000, currentTime: 0 },
    _buffer: buffer  // exposed for test manipulation
  };
}
```

### Mock MediaStream

```typescript
function createMockStream() {
  const track = { stop: vi.fn(), kind: 'audio' };
  return {
    getTracks: vi.fn(() => [track]),
    _track: track
  };
}
```

### Mock Navigator

```typescript
vi.stubGlobal('navigator', {
  mediaDevices: {
    getUserMedia: vi.fn(async () => mockStream)
  },
  permissions: {
    query: vi.fn()
  }
});
```

## Mocking Module Dependencies

Use `vi.mock()` to mock internal modules before importing the module under test:

```typescript
let mockAudioCtx: ReturnType<typeof createMockAudioContext>;

vi.mock('$lib/audio/audio-context.ts', () => ({
  initAudio: vi.fn(async () => mockAudioCtx)
}));
```

### Reset Between Tests

Audio modules use module-level singletons. Use `vi.resetModules()` in `beforeEach` and re-import:

```typescript
let captureModule: typeof import('$lib/audio/capture.ts');

beforeEach(async () => {
  vi.resetModules();
  mockAudioCtx = createMockAudioContext();
  captureModule = await import('$lib/audio/capture.ts');
});
```

## Testing Patterns

### Pure Function Tests

Most scoring, music theory, and phrase modules are pure functions — test directly without mocks:

```typescript
import { segmentNotes } from '$lib/audio/note-segmenter.ts';

it('uses median MIDI note for robustness', () => {
  const readings = [
    makeReading(60, 0.1),  // C4
    makeReading(60, 0.2),  // C4
    makeReading(61, 0.3),  // C#4 (outlier)
  ];
  const notes = segmentNotes(readings, [0.0], 0.5);
  expect(notes[0].midi).toBe(60);  // median wins
});
```

### Helper Factories

Create helpers for common test data:

```typescript
function makeReading(midi: number, time: number): PitchReading {
  return {
    midiFloat: midi,
    midi,
    cents: 0,
    clarity: 0.9,
    time,
    frequency: 440 * Math.pow(2, (midi - 69) / 12)
  };
}
```

### Testing Scoring

```typescript
import { scorePitch } from '$lib/scoring/pitch-scoring.ts';

it('returns 1.0 for correct MIDI note', () => {
  const expected = { pitch: 60, duration: [1, 4], offset: [0, 1] };
  const detected = { midi: 60, cents: 0, onsetTime: 0, duration: 0.5, clarity: 0.9 };
  expect(scorePitch(expected, detected)).toBe(1.1);  // 1.0 + 0.1 intonation bonus
});

it('returns 0.0 for wrong MIDI note', () => {
  const expected = { pitch: 60, duration: [1, 4], offset: [0, 1] };
  const detected = { midi: 62, cents: 0, onsetTime: 0, duration: 0.5, clarity: 0.9 };
  expect(scorePitch(expected, detected)).toBe(0);
});
```

### Testing Adaptive Difficulty

```typescript
import { createInitialAdaptiveState, processAttempt } from '$lib/difficulty/adaptive.ts';

it('advances after consistent high scores', () => {
  let state = createInitialAdaptiveState();
  for (let i = 0; i < 10; i++) {
    state = processAttempt(state, 0.90, 0.90, 0.90);
  }
  expect(state.currentLevel).toBeGreaterThan(1);
});
```

### Testing Validation

```typescript
import { validatePhrase, rulesForDifficulty } from '$lib/phrases/validator.ts';

it('rejects phrases with intervals too large for the level', () => {
  const phrase = makePhraseWithInterval(10);  // 10 semitones
  const rules = rulesForDifficulty(1);        // max 5 semitones
  const result = validatePhrase(phrase, rules);
  expect(result.valid).toBe(false);
});
```

## What to Test

### High Priority
- **Scoring pipeline** — DTW alignment, pitch/rhythm scoring, grade assignment
- **Adaptive difficulty** — State transitions, level changes
- **Note segmentation** — Median robustness, onset boundaries, edge cases
- **Music theory** — Interval math, transposition, scale realization
- **Validation** — Contour rules, range checks

### Medium Priority
- **Phrase generator** — Output validity, stage pipeline
- **Library loader** — Query filtering, transposition
- **Persistence** — Save/load round-trip

### Not Testable in Node
- **Svelte components** — Require browser environment (use Playwright for E2E)
- **Audio playback** — Requires real AudioContext and Tone.js
- **Pitch detection** — Requires real audio signal

## Tips

- Keep tests focused: one assertion per test when practical
- Use descriptive test names that read as specifications
- Test edge cases: empty arrays, zero values, boundary conditions
- Use `toBeCloseTo()` for floating-point comparisons
- Don't test implementation details — test behavior and outputs
