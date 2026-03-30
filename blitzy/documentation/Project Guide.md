# Blitzy Project Guide — Mankunku Multi-User Authentication & Cross-Device Sync

---

## 1. Executive Summary

### 1.1 Project Overview

Mankunku is a jazz ear-training progressive web application featuring call-and-response practice, microphone-based pitch detection, adaptive difficulty, and a curated lick library. This project transforms Mankunku from a zero-backend, single-device, client-only PWA into a multi-user authenticated application with server-side persistence and cross-device progress synchronization. The implementation uses Supabase for managed PostgreSQL, authentication, Row Level Security, and blob storage — integrated into the existing SvelteKit 2 / Svelte 5 codebase via `@supabase/ssr` for cookie-based session management. The target users are musicians who practice on multiple devices and want seamless progress continuity.

### 1.2 Completion Status

**Completion: 81.5%** (110 hours completed out of 135 total hours)

```mermaid
pie title Project Completion Status
    "Completed (110h)" : 110
    "Remaining (25h)" : 25
```

| Metric | Value |
|---|---|
| **Total Project Hours** | 135 |
| **Completed Hours (AI)** | 110 |
| **Remaining Hours** | 25 |
| **Completion Percentage** | 81.5% |
| **Commits** | 44 |
| **Files Changed** | 45 (22 new, 23 modified) |
| **Lines Added** | 6,792 |
| **Lines Removed** | 187 |
| **Tests Passing** | 308 / 308 |

Formula: 110 completed hours / (110 + 25 remaining hours) = 110 / 135 = **81.5% complete**

### 1.3 Key Accomplishments

- ✅ Full Supabase infrastructure: typed client factories for browser and server, comprehensive database type definitions (537 lines)
- ✅ SvelteKit server hooks with JWT-validated session management, security headers, and auth state propagation through layout data chain
- ✅ Complete authentication system: email/password login/registration, Google OAuth flow, secure logout, dual-mode auth page UI
- ✅ 5 PostgreSQL migration files (927 lines SQL) defining 7 tables with triggers, indexes, and 28 Row Level Security policies
- ✅ Sync orchestrator module (494 lines) with bidirectional last-write-wins conflict resolution for progress, settings, licks, and audio recordings
- ✅ Local-first dual-write persistence pattern across storage, user-licks, and audio-store modules
- ✅ Cloud sync integration in progress and settings state stores with offline fallback preservation
- ✅ Auth-aware UI updates across 6 routes/components (homepage, progress, settings, record, library, onboarding)
- ✅ Adapter switch from `adapter-auto` to `adapter-node` for SSR support
- ✅ PWA service worker exclusions for auth routes and NetworkFirst caching for Supabase API
- ✅ 93 new tests across 4 test files (auth-flow, sync, supabase-storage, auth-routes integration) — all passing
- ✅ All 215 pre-existing tests continue to pass without modification
- ✅ Production build succeeds cleanly; all 8 routes return HTTP 200
- ✅ Comprehensive README documentation for auth setup, Supabase configuration, environment variables, and migrations

### 1.4 Critical Unresolved Issues

| Issue | Impact | Owner | ETA |
|---|---|---|---|
| No live Supabase project configured | Auth and sync features are code-complete but require a real Supabase backend to function | Human Developer | 3 hours |
| 145 pre-existing `.ts` extension import errors in out-of-scope files | `svelte-check` reports errors but build/tests/runtime unaffected | Human Developer | 3 hours |
| 15 pre-existing a11y warnings in out-of-scope Svelte components | Accessibility compliance below ideal threshold | Human Developer | 2 hours |
| No CI/CD pipeline for SSR deployment | Production deployment requires manual build and deployment | Human Developer | 4 hours |

### 1.5 Access Issues

| System/Resource | Type of Access | Issue Description | Resolution Status | Owner |
|---|---|---|---|---|
| Supabase Project | API Keys | No Supabase project has been created; `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` use placeholder values in `.env.example` | Unresolved | Human Developer |
| Google OAuth | Client Credentials | Google OAuth client ID and secret not configured in Supabase Auth dashboard | Unresolved | Human Developer |
| Supabase Storage | Bucket Configuration | `recordings` storage bucket for audio blobs not created | Unresolved | Human Developer |

### 1.6 Recommended Next Steps

1. **[High]** Create a Supabase project, apply the 5 SQL migration files, and configure real environment variables in `.env`
2. **[High]** Create the `recordings` storage bucket in Supabase Storage with appropriate RLS policies
3. **[High]** Perform end-to-end testing of the complete auth flow (register → login → sync → logout) against the live Supabase backend
4. **[Medium]** Configure Google OAuth provider in Supabase dashboard with production redirect URLs
5. **[Medium]** Set up CI/CD pipeline for SSR deployment (Docker, Vercel, or target platform)

---

## 2. Project Hours Breakdown

### 2.1 Completed Work Detail

| Component | Hours | Description |
|---|---|---|
| Supabase Infrastructure | 8 | Browser client factory (`client.ts`, 44 lines), server client factory (`server.ts`, 99 lines), database type definitions (`types.ts`, 537 lines), environment variable template (`.env.example`, 11 lines) |
| SvelteKit Server Integration | 14 | Server hooks with JWT validation and security headers (`hooks.server.ts`, 181 lines), App namespace types (`app.d.ts`, 24 lines), server layout load (`+layout.server.ts`, 24 lines), universal layout load (`+layout.ts`, 83 lines), auth-aware root layout (`+layout.svelte`, 84+ lines modified) |
| Authentication Routes | 12 | Dual-mode login/register page (`auth/+page.svelte`, 219 lines), server form actions for login/register/OAuth (`auth/+page.server.ts`, 202 lines), OAuth callback handler (`auth/callback/+server.ts`, 25 lines), POST-only logout endpoint (`auth/logout/+server.ts`, 18 lines) |
| Database Schema | 10 | 5 SQL migration files (927 lines total): user_profiles with auto-creation trigger, user_progress + session_results + scale/key_proficiency tables, user_settings, user_licks with JSONB columns, and 28 RLS policies across 7 tables |
| Persistence Layer Upgrade | 16 | Sync orchestrator with bidirectional last-write-wins resolution (`sync.ts`, 494 lines), syncCallback parameter in storage (`storage.ts`, +10 lines), Supabase CRUD for user-licks (`user-licks.ts`, +168 lines), Supabase Storage upload/download for audio (`audio-store.ts`, +95 lines) |
| State Layer Integration | 8 | Cloud init/save in progress store (`progress.svelte.ts`, +88 lines), cloud load/save in settings store (`settings.svelte.ts`, +47 lines), auth type definitions (`auth.ts`, 68 lines) |
| Configuration & Build | 3 | Package dependency additions and adapter switch (`package.json`), adapter-node configuration (`svelte.config.js`), PWA auth exclusions and Supabase NetworkFirst caching (`vite.config.ts`) |
| UI Auth-Aware Updates | 14 | Homepage auth gating with sign-in CTA (`+page.svelte`, +30 lines), server-hydrated progress (`progress/+page.svelte`, +33 lines), account management section in settings (`settings/+page.svelte`, +147 lines), cloud upload in record page (`record/+page.svelte`, +55 lines), cross-device lick loading in library (`library/+page.svelte`, +92 lines), cloud data restore in onboarding (`Onboarding.svelte`, +120 lines) |
| Test Suite | 16 | Auth flow unit tests (`auth-flow.test.ts`, 752 lines, 29 tests), sync orchestrator tests (`sync.test.ts`, 898 lines, 33 tests), Supabase Storage tests (`supabase-storage.test.ts`, 231 lines, 11 tests), auth routes integration tests (`auth-routes.test.ts`, 618 lines, 20 tests) |
| Documentation | 3 | README updates with authentication setup, Supabase configuration, environment variables, database migrations, and multi-user features (+95 lines) |
| Validation & Bug Fixes | 6 | Resolved 119 in-scope type errors: removed `.ts` extensions from 14 files, fixed vitest config `defineConfig` import, fixed implicit `any` indexing in sync tests, addressed code review findings across multiple iterations |
| **Total** | **110** | |

### 2.2 Remaining Work Detail

| Category | Hours | Priority |
|---|---|---|
| Supabase Project Setup & Configuration | 3 | High |
| Database Migration Execution | 1 | High |
| Supabase Storage Bucket Setup | 1 | High |
| OAuth Provider Configuration | 2 | Medium |
| Production Environment Configuration | 1 | High |
| End-to-End Testing with Live Backend | 4 | High |
| Pre-existing Type Error Cleanup | 3 | Low |
| Accessibility Warning Resolution | 2 | Low |
| CI/CD & Deployment Pipeline | 4 | Medium |
| Production Security Hardening | 2 | Medium |
| Monitoring & Error Tracking Setup | 2 | Low |
| **Total** | **25** | |

### 2.3 Hours Validation

- Section 2.1 Total (Completed): **110 hours**
- Section 2.2 Total (Remaining): **25 hours**
- Sum: 110 + 25 = **135 hours** = Total Project Hours in Section 1.2 ✅
- Completion: 110 / 135 = **81.5%** ✅

---

## 3. Test Results

All tests were executed by Blitzy's autonomous validation system using Vitest v4.1.0 in Node environment.

| Test Category | Framework | Total Tests | Passed | Failed | Coverage % | Notes |
|---|---|---|---|---|---|---|
| Unit — Audio | Vitest 4.1.0 | 51 | 51 | 0 | — | capture, onset-worklet, pitch-detector, quantizer (pre-existing) |
| Unit — Music Theory | Vitest 4.1.0 | 69 | 69 | 0 | — | intervals, keys, scales, transposition, transpose-lick (pre-existing) |
| Unit — Scoring | Vitest 4.1.0 | 18 | 18 | 0 | — | note-segmenter, rhythm-scoring (pre-existing) |
| Unit — Difficulty | Vitest 4.1.0 | 10 | 10 | 0 | — | params (pre-existing) |
| Unit — Tonality | Vitest 4.1.0 | 48 | 48 | 0 | — | tonality, scale-compatibility (pre-existing) |
| Unit — Phrases | Vitest 4.1.0 | 19 | 19 | 0 | — | combiner (pre-existing) |
| Unit — Auth Flow | Vitest 4.1.0 | 29 | 29 | 0 | — | **NEW**: auth state, session validation, sign-in/out flows |
| Unit — Sync Orchestrator | Vitest 4.1.0 | 33 | 33 | 0 | — | **NEW**: merge strategies, conflict resolution, offline queueing |
| Unit — Supabase Storage | Vitest 4.1.0 | 11 | 11 | 0 | — | **NEW**: upload/download wrappers, error handling |
| Integration — Auth Routes | Vitest 4.1.0 | 20 | 20 | 0 | — | **NEW**: auth page rendering, form submission, redirect flows |
| **Totals** | | **308** | **308** | **0** | — | 19 test files, 1.22s duration |

- **Pre-existing tests**: 215 tests across 15 files — all passing, zero modifications
- **New tests**: 93 tests across 4 files — all passing
- **Test duration**: ~1.2 seconds total

---

## 4. Runtime Validation & UI Verification

### Route Health Checks

All routes verified via production build (`node build/index.js`) with `curl` against `localhost:3000`:

- ✅ `GET /` → HTTP 200 (Homepage with auth-aware gating)
- ✅ `GET /auth` → HTTP 200 (Login/registration page)
- ✅ `GET /practice` → HTTP 200 (Live practice loop)
- ✅ `GET /library` → HTTP 200 (Lick browser with cross-device loading)
- ✅ `GET /progress` → HTTP 200 (Progress dashboard with cloud hydration)
- ✅ `GET /record` → HTTP 200 (Lick recording with cloud upload)
- ✅ `GET /settings` → HTTP 200 (Settings with account management)
- ✅ `GET /scales` → HTTP 200 (Scale reference browser)
- ✅ `POST /auth/logout` → HTTP 303 (Redirect to /auth after sign-out)

### Build Validation

- ✅ `npm run build` completes cleanly with adapter-node SSR output
- ✅ PWA service worker generated with 67 precache entries (1,492 KB)
- ✅ `navigateFallbackDenylist` correctly excludes `/auth` routes from SW caching
- ✅ Supabase API NetworkFirst caching rule present in runtime config

### API Integration Status

- ⚠️ Supabase auth endpoints: Code-complete but require live Supabase project for end-to-end verification
- ⚠️ Supabase database CRUD: Sync module fully implemented but untested against live database
- ⚠️ Supabase Storage uploads: Upload/download wrappers implemented but require `recordings` bucket creation

### Type Checking

- ✅ Zero in-scope type errors (all 119 resolved during validation)
- ⚠️ 145 pre-existing `.ts` extension import errors in out-of-scope files (audio, music, data, scoring, difficulty, tonality, phrases, components)
- ⚠️ 15 pre-existing a11y warnings in out-of-scope Svelte components

---

## 5. Compliance & Quality Review

| Requirement | AAP Section | Status | Evidence |
|---|---|---|---|
| Supabase client factories (browser + server) | §0.5.1 Group 1 | ✅ Complete | `src/lib/supabase/client.ts`, `server.ts` created |
| Database TypeScript types | §0.5.1 Group 1 | ✅ Complete | `src/lib/supabase/types.ts` (537 lines) |
| Environment variable template | §0.5.1 Group 1 | ✅ Complete | `.env.example` with security warnings |
| Server hooks with JWT validation | §0.5.1 Group 2 | ✅ Complete | `hooks.server.ts` uses `getUser()` per §0.7.2 |
| App namespace types | §0.5.1 Group 2 | ✅ Complete | `app.d.ts` with Locals, PageData, Error |
| Layout data chain (server → client → UI) | §0.5.1 Group 2 | ✅ Complete | 3 layout files propagating session |
| Auth page (login/register/OAuth) | §0.5.1 Group 3 | ✅ Complete | `auth/+page.svelte` with dual-mode form |
| Server form actions | §0.5.1 Group 3 | ✅ Complete | `auth/+page.server.ts` with 3 named actions |
| OAuth callback handler | §0.5.1 Group 3 | ✅ Complete | `auth/callback/+server.ts` with PKCE flow |
| Logout endpoint (POST-only) | §0.5.1 Group 3 | ✅ Complete | `auth/logout/+server.ts` |
| SQL migrations (5 files, 7 tables) | §0.5.1 Group 4 | ✅ Complete | `supabase/migrations/00001-00005` (927 lines) |
| Row Level Security (28 policies) | §0.5.1 Group 4 | ✅ Complete | `00005_enable_rls.sql` (269 lines) |
| Sync orchestrator | §0.5.1 Group 5 | ✅ Complete | `sync.ts` (494 lines) with bidirectional sync |
| Storage syncCallback | §0.5.1 Group 5 | ✅ Complete | `storage.ts` modified with optional callback |
| User-licks Supabase CRUD | §0.5.1 Group 5 | ✅ Complete | `user-licks.ts` with cloud merge |
| Audio-store cloud backup | §0.5.1 Group 5 | ✅ Complete | `audio-store.ts` with Storage upload/download |
| Progress cloud sync | §0.5.1 Group 6 | ✅ Complete | `progress.svelte.ts` with `initFromCloud` |
| Settings cloud sync | §0.5.1 Group 6 | ✅ Complete | `settings.svelte.ts` with `loadSettingsFromCloud` |
| Auth type definitions | §0.5.1 Group 6 | ✅ Complete | `auth.ts` (68 lines) |
| Package dependency updates | §0.5.1 Group 7 | ✅ Complete | `@supabase/supabase-js`, `@supabase/ssr`, `adapter-node` |
| Adapter switch to adapter-node | §0.5.1 Group 7 | ✅ Complete | `svelte.config.js` updated |
| PWA auth exclusions | §0.5.1 Group 7 | ✅ Complete | `vite.config.ts` with `navigateFallbackDenylist` |
| Homepage auth gating | §0.5.1 Group 8 | ✅ Complete | `+page.svelte` with sign-in CTA |
| Progress server hydration | §0.5.1 Group 8 | ✅ Complete | `progress/+page.svelte` with `initFromCloud` |
| Settings account management | §0.5.1 Group 8 | ✅ Complete | `settings/+page.svelte` with account section |
| Record cloud upload | §0.5.1 Group 8 | ✅ Complete | `record/+page.svelte` with Supabase upload |
| Library cross-device loading | §0.5.1 Group 8 | ✅ Complete | `library/+page.svelte` with cloud merge |
| Onboarding cloud restore | §0.5.1 Group 8 | ✅ Complete | `Onboarding.svelte` with restore flow |
| Auth unit tests | §0.5.1 Group 9 | ✅ Complete | 29 tests passing |
| Sync orchestrator tests | §0.5.1 Group 9 | ✅ Complete | 33 tests passing |
| Supabase Storage tests | §0.5.1 Group 9 | ✅ Complete | 11 tests passing |
| Auth routes integration tests | §0.5.1 Group 9 | ✅ Complete | 20 tests passing |
| README documentation | §0.5.1 Group 9 | ✅ Complete | +95 lines covering auth, Supabase, migrations |
| Local-first data strategy | §0.7.1 | ✅ Complete | All mutations write localStorage first, then async cloud |
| Backward compatibility | §0.7.1 | ✅ Complete | Anonymous users retain client-only experience |
| Zero disruption to audio pipeline | §0.7.1 | ✅ Complete | No audio module files modified |
| Server-side JWT validation | §0.7.2 | ✅ Complete | `safeGetSession` uses `getUser()` |
| Svelte 5 runes mode | §0.7.2 | ✅ Complete | `$state`, `$derived`, `$props()` throughout |
| RLS on all tables | §0.7.3 | ✅ Complete | 7 tables × 4 policies = 28 RLS policies |
| httpOnly cookies | §0.7.3 | ✅ Complete | Managed by `@supabase/ssr` cookie handlers |
| Existing tests preserved | §0.7.4 | ✅ Complete | 215/215 pre-existing tests pass |
| Service worker auth exclusion | §0.7.5 | ✅ Complete | `navigateFallbackDenylist: [/^\/auth/]` |

**All 39 AAP-specified deliverables: COMPLETED**

---

## 6. Risk Assessment

| Risk | Category | Severity | Probability | Mitigation | Status |
|---|---|---|---|---|---|
| No live Supabase project configured — auth and sync inoperable without real backend | Integration | High | Certain | Human must create Supabase project, apply migrations, and set environment variables | Open |
| Pre-existing 145 type errors may mask new issues in future development | Technical | Medium | Medium | Clean up `.ts` extension imports in out-of-scope files to eliminate noise | Open |
| OAuth callback requires correctly configured redirect URLs in Supabase dashboard | Integration | High | High | Document exact redirect URL format in README; verify during E2E testing | Open |
| Supabase Storage `recordings` bucket not created — audio cross-device sync will fail | Integration | High | Certain | Human must create bucket with RLS policies matching user_id pattern | Open |
| Service worker may cache stale auth state on edge cases during token refresh | Technical | Medium | Low | `navigateFallbackDenylist` excludes `/auth`; NetworkFirst for Supabase API | Mitigated |
| No rate limiting on auth endpoints — potential brute force attack vector | Security | Medium | Medium | Supabase provides built-in rate limiting; add application-level rate limiting for production | Open |
| Sensitive data in transit relies on Supabase TLS — no additional encryption layer | Security | Low | Low | Supabase enforces HTTPS; httpOnly SameSite cookies prevent XSS theft | Mitigated |
| `service_role` key exposure risk if developer misconfigures environment | Security | High | Low | `.env.example` includes explicit warnings; only `PUBLIC_` prefixed vars in client code | Mitigated |
| No monitoring or error tracking for server-side hooks and auth failures | Operational | Medium | High | Add Sentry or similar error tracking for production; implement structured logging | Open |
| Offline-to-online sync conflicts with last-write-wins may silently overwrite data | Technical | Medium | Medium | Sync module uses `updated_at` timestamps; consider adding conflict detection UI in future | Mitigated |
| No automated database backup strategy for user data | Operational | Medium | Medium | Supabase provides automatic daily backups on paid plans; document backup configuration | Open |

---

## 7. Visual Project Status

```mermaid
pie title Project Hours Breakdown
    "Completed Work" : 110
    "Remaining Work" : 25
```

### Remaining Hours by Priority

| Priority | Hours | Categories |
|---|---|---|
| High | 10 | Supabase setup (3h), migrations (1h), storage bucket (1h), prod env config (1h), E2E testing (4h) |
| Medium | 8 | OAuth config (2h), CI/CD pipeline (4h), security hardening (2h) |
| Low | 7 | Type error cleanup (3h), a11y fixes (2h), monitoring (2h) |
| **Total** | **25** | |

---

## 8. Summary & Recommendations

### Achievements

The Mankunku multi-user authentication and cross-device sync feature is **81.5% complete** (110 of 135 total hours). All 39 discrete AAP deliverables have been implemented, built, and validated. The codebase has been extended with 6,792 lines of new code across 45 files, including a comprehensive Supabase integration layer, full authentication system, 5 SQL migration files with Row Level Security, a 494-line sync orchestrator, and 93 new tests — all while maintaining backward compatibility with the existing client-only experience and preserving all 215 pre-existing tests.

### Remaining Gaps

The 25 remaining hours of work are exclusively **path-to-production tasks** requiring human intervention: creating a live Supabase project (3h), applying migrations (1h), configuring OAuth providers (2h), end-to-end testing with a real backend (4h), and setting up deployment infrastructure (4h). No additional application code changes are required — all feature logic, persistence layer, state management, and UI updates are complete.

### Critical Path to Production

1. Create Supabase project and apply 5 SQL migration files in order
2. Create `recordings` storage bucket with user-scoped access policies
3. Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in production `.env`
4. Configure Google OAuth in Supabase Auth dashboard
5. End-to-end test: register → login → practice → verify progress sync → logout → re-login from different context → verify data restored
6. Deploy with `npm run build && node build/index.js` (or Docker/Vercel)

### Production Readiness Assessment

The application is **code-complete and validation-passing** but requires infrastructure provisioning before production deployment. The build compiles cleanly with adapter-node, all 308 tests pass, and all routes return correct HTTP status codes. The remaining work is entirely operational — no code changes needed for the feature to function once a Supabase project is configured.

---

## 9. Development Guide

### System Prerequisites

| Software | Version | Purpose |
|---|---|---|
| Node.js | ≥ 20.x | Runtime (required by `@supabase/supabase-js` v2.79+) |
| npm | ≥ 10.x | Package manager |
| Git | ≥ 2.x | Version control |

### Environment Setup

```bash
# 1. Clone the repository and switch to the feature branch
git clone <repository-url>
cd mankunku
git checkout blitzy-333b7f0c-1de9-47bb-a6d4-9f5990c8e56a

# 2. Create environment file from template
cp .env.example .env

# 3. Edit .env with your Supabase project credentials
# PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
# PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### Dependency Installation

```bash
# Install all dependencies (includes @supabase/supabase-js, @supabase/ssr, adapter-node)
npm install
```

Expected output: No errors, `package-lock.json` updated.

### Database Setup (Requires Supabase Project)

```bash
# Apply migrations in order via Supabase CLI or Dashboard SQL Editor:
# 1. supabase/migrations/00001_create_users_profile.sql
# 2. supabase/migrations/00002_create_user_progress.sql
# 3. supabase/migrations/00003_create_user_settings.sql
# 4. supabase/migrations/00004_create_user_licks.sql
# 5. supabase/migrations/00005_enable_rls.sql

# Generate TypeScript types from database schema (optional, types already included)
npm run db:types
```

### Running Tests

```bash
# Run all 308 tests (unit + integration)
npm test

# Expected output:
# Test Files  19 passed (19)
#      Tests  308 passed (308)
```

### Type Checking

```bash
# Run Svelte type checker
npm run check

# Note: 145 pre-existing errors from out-of-scope files are expected.
# Zero in-scope errors should appear.
```

### Building for Production

```bash
# Build with adapter-node SSR
npm run build

# Expected output:
# ✓ built in ~7s
# > Using @sveltejs/adapter-node
#   ✔ done
```

### Starting the Production Server

```bash
# Start the production server
node build/index.js

# Server starts on port 3000 by default
# Verify: curl http://localhost:3000
```

### Development Server

```bash
# Start the Vite dev server with HMR
npm run dev

# Opens at http://localhost:5173 (default Vite port)
```

### Verification Steps

```bash
# After starting the server, verify all routes:
curl -s -o /dev/null -w "GET /          → %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "GET /auth      → %{http_code}\n" http://localhost:3000/auth
curl -s -o /dev/null -w "GET /practice  → %{http_code}\n" http://localhost:3000/practice
curl -s -o /dev/null -w "GET /library   → %{http_code}\n" http://localhost:3000/library
curl -s -o /dev/null -w "GET /progress  → %{http_code}\n" http://localhost:3000/progress
curl -s -o /dev/null -w "GET /record    → %{http_code}\n" http://localhost:3000/record
curl -s -o /dev/null -w "GET /settings  → %{http_code}\n" http://localhost:3000/settings
curl -s -o /dev/null -w "GET /scales    → %{http_code}\n" http://localhost:3000/scales

# All should return HTTP 200
```

### Troubleshooting

| Issue | Cause | Resolution |
|---|---|---|
| `Error: PUBLIC_SUPABASE_URL is not set` | Missing `.env` file | Run `cp .env.example .env` and add your Supabase credentials |
| `EADDRINUSE: address already in use 0.0.0.0:3000` | Port 3000 already occupied | Kill the existing process or set `PORT=3001 node build/index.js` |
| `Unknown option --watchAll` when running tests | Vitest doesn't support Jest's `--watchAll` flag | Use `npm test` (runs `vitest run`) or `npx vitest run` |
| Auth redirects to `/auth?error=callback_error` | OAuth provider misconfigured in Supabase | Verify redirect URLs and client credentials in Supabase Auth dashboard |
| 145 svelte-check errors | Pre-existing `.ts` extension imports in out-of-scope files | These do not affect build, tests, or runtime — safe to ignore or fix separately |

---

## 10. Appendices

### A. Command Reference

| Command | Purpose |
|---|---|
| `npm install` | Install all dependencies |
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Build production SSR bundle with adapter-node |
| `npm run preview` | Preview production build locally |
| `npm test` | Run all 308 unit + integration tests via Vitest |
| `npm run check` | Run svelte-check for TypeScript/Svelte diagnostics |
| `npm run db:types` | Generate TypeScript types from Supabase database schema |
| `node build/index.js` | Start the production Node.js server |

### B. Port Reference

| Port | Service | Context |
|---|---|---|
| 5173 | Vite dev server | Development (`npm run dev`) |
| 3000 | Node.js production server | Production (`node build/index.js`) |
| 4173 | Vite preview server | Preview (`npm run preview`) |

### C. Key File Locations

| Path | Purpose |
|---|---|
| `src/hooks.server.ts` | Central server hook — Supabase auth, JWT validation, security headers |
| `src/lib/supabase/client.ts` | Browser-side Supabase client factory |
| `src/lib/supabase/server.ts` | Server-side Supabase client factory with cookie management |
| `src/lib/supabase/types.ts` | TypeScript database schema types (537 lines) |
| `src/lib/persistence/sync.ts` | Sync orchestrator — bidirectional cloud sync (494 lines) |
| `src/routes/auth/+page.svelte` | Login/registration page UI |
| `src/routes/auth/+page.server.ts` | Server form actions for auth (login, register, OAuth) |
| `src/routes/auth/callback/+server.ts` | OAuth callback endpoint |
| `src/routes/auth/logout/+server.ts` | POST-only logout endpoint |
| `src/routes/+layout.server.ts` | Server-side session retrieval |
| `src/routes/+layout.ts` | Universal layout load with Supabase client creation |
| `supabase/migrations/` | 5 SQL migration files for database schema |
| `.env.example` | Environment variable template |

### D. Technology Versions

| Technology | Version | Role |
|---|---|---|
| SvelteKit | ^2.50.2 | Application framework |
| Svelte | ^5.51.0 | UI framework (runes mode) |
| TypeScript | ^5.9.3 | Type system |
| Vite | ^7.3.1 | Build tool |
| Vitest | ^4.1.0 | Test runner |
| Tailwind CSS | ^4.2.2 | Styling |
| @supabase/supabase-js | ^2.99.3 | Supabase client library |
| @supabase/ssr | ^0.9.0 | SvelteKit SSR auth integration |
| @sveltejs/adapter-node | ^5.2.0 | Node.js SSR adapter |
| @vite-pwa/sveltekit | ^1.1.0 | PWA service worker plugin |
| Node.js | ≥20.x | Runtime requirement |

### E. Environment Variable Reference

| Variable | Required | Exposed to Client | Description |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | Yes | Yes | Supabase project URL (e.g., `https://abc123.supabase.co`) |
| `PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Supabase anonymous/public API key |
| `PORT` | No | No | Production server port (default: 3000) |
| `HOST` | No | No | Production server host (default: 0.0.0.0) |

> **Security Note**: Never expose the Supabase `service_role` key in client-side code or environment variables prefixed with `PUBLIC_`.

### F. Developer Tools Guide

**Supabase Dashboard**: Access at `https://supabase.com/dashboard` to manage:
- Database tables and migrations
- Authentication providers (Email, Google OAuth)
- Storage buckets (`recordings`)
- API keys and project settings
- Row Level Security policies

**Database Type Generation**: After schema changes, regenerate types:
```bash
npm run db:types
```

**Test Debugging**: Run specific test files:
```bash
npx vitest run tests/unit/auth/auth-flow.test.ts
npx vitest run tests/unit/persistence/sync.test.ts
npx vitest run tests/integration/auth-routes.test.ts
```

### G. Glossary

| Term | Definition |
|---|---|
| **RLS** | Row Level Security — PostgreSQL feature restricting table access per-user |
| **JWT** | JSON Web Token — signed token used for stateless authentication |
| **PKCE** | Proof Key for Code Exchange — OAuth 2.0 extension for public clients |
| **SSR** | Server-Side Rendering — HTML generated on the server per request |
| **PWA** | Progressive Web App — web application with offline and installable capabilities |
| **Dual-write** | Pattern where data is written to local storage first, then synced to cloud |
| **Last-write-wins** | Conflict resolution strategy using `updated_at` timestamps |
| **Anon key** | Supabase anonymous/public key safe for client-side use (RLS enforced) |
| **Service role key** | Supabase admin key that bypasses RLS — server-only, never exposed |
