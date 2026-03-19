# Contributing

Guidelines for contributing to Mankunku.

## Development Setup

See [Getting Started](../getting-started.md) for prerequisites and installation.

## Code Style

### TypeScript

- Strict mode (`"strict": true` in `tsconfig.json`)
- Bundler module resolution
- All imports use `.ts` extensions (e.g. `import { foo } from './bar.ts'`)
- Prefer `const` over `let`; avoid `var`
- Use explicit types for function parameters and return values
- Use `type` imports for type-only imports

### Svelte

- Svelte 5 runes only — no Svelte 4 stores or `$:` reactive statements
- `$state()` for reactive state, `$derived()` for computed values, `$props()` for component inputs, `$effect()` for side effects
- Components use `interface Props` pattern for typed props
- Use Tailwind CSS utility classes with CSS custom properties for theming
- Component files: PascalCase (e.g. `MicStatus.svelte`)

### CSS

- Tailwind utility-first approach
- Theme colors via CSS custom properties (`var(--color-accent)`, etc.)
- Defined in `src/app.css` for both dark and light modes
- Component-scoped `<style>` blocks for non-utility CSS (e.g. abcjs SVG overrides)

### File Organization

- Module files: kebab-case (e.g. `pitch-detector.ts`)
- State modules: `.svelte.ts` extension (e.g. `session.svelte.ts`)
- Types in `src/lib/types/` grouped by domain
- One module per concern — avoid god files

## Architecture Conventions

### Concert Pitch Canonical

All pitches are stored and processed in **concert pitch** (MIDI note numbers). Transposition to written pitch happens only at display time, in two places:
- `phraseToAbc()` in `notation.ts`
- `concertToWritten()` in `transposition.ts`

### Fractions for Rhythm

Note durations and offsets use `[numerator, denominator]` tuples (type `Fraction`) to avoid floating-point errors. Convert to floats only when computing seconds or ticks.

### Explicit State Saves

State is **not** auto-saved on every change. Call `saveSettings()` or `saveProgress()` explicitly after user-initiated mutations. This avoids excessive writes during real-time operations (e.g. pitch detection updating at 60fps).

### Dynamic Imports

Heavy libraries (Tone.js, smplr, Pitchy, abcjs) are dynamically imported to keep initial bundle size small.

## Workflow

### Branch Naming

- `feature/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation
- `refactor/description` — Code restructuring

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add retrograde mutation for lick variations
fix: correct latency correction in scorer
docs: add API reference for scoring module
refactor: extract chord tone logic to chords.ts
test: add capture module unit tests
```

### Pull Requests

- One feature/fix per PR
- Include description of what changed and why
- Reference any related issues
- Ensure all tests pass (`npm run test:unit`)
- Ensure build succeeds (`npm run build`)

## Running Tests

```bash
# Unit tests
npm run test:unit

# Watch mode
npx vitest

# Specific test file
npx vitest tests/unit/audio/capture.test.ts
```

See [Testing Guide](testing-guide.md) for patterns and conventions.

## Building

```bash
# Development server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```
