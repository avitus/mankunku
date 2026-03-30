# Mankunku

Jazz ear training progressive web application with call-and-response practice, powered by [SvelteKit](https://svelte.dev) and [Supabase](https://supabase.com).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.12.8 create --template minimal --types ts --no-install .
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> This project uses [`@sveltejs/adapter-node`](https://svelte.dev/docs/kit/adapters) for server-side rendering, which is required for authentication and session management. See the [SvelteKit adapters documentation](https://svelte.dev/docs/kit/adapters) if you need to deploy to a different target environment.

## Authentication

Mankunku uses [Supabase](https://supabase.com) for authentication and backend persistence. Two authentication methods are supported:

- **Email / Password** — Register with an email address and password.
- **Google OAuth** — Sign in with a Google account for one-click access.

To sign in or create an account, visit the `/auth` route in the application. Once authenticated, your practice progress, settings, recorded licks, and audio recordings sync across all your devices automatically.

Users who prefer not to sign in can continue using Mankunku as a fully client-only application — all data is stored locally in the browser, exactly as before. Authentication is optional but unlocks cross-device progress synchronization.

## Supabase Configuration

To run Mankunku with authentication and cloud sync, you need a Supabase project:

1. Create a free project at [supabase.com](https://supabase.com).
2. Copy your project's **URL** and **anon (public) key** from the Supabase Dashboard under **Settings → API**.
3. Apply the database migration files located in `supabase/migrations/` to your project (see [Database Migrations](#database-migrations) below).
4. Enable the authentication providers you want to support (Email and/or Google OAuth) in the Supabase Dashboard under **Authentication → Providers**.

After applying migrations, you can generate TypeScript types for the database schema:

```sh
npm run db:types
```

This runs `supabase gen types typescript --local` and writes the output to `src/lib/supabase/types.ts`. If you are generating types against a remote Supabase project instead of a local instance, remove the `--local` flag or update the script in `package.json`.

## Environment Variables

Mankunku requires the following environment variables for Supabase integration:

| Variable | Description |
|---|---|
| `PUBLIC_SUPABASE_URL` | Your Supabase project URL (e.g. `https://abc123.supabase.co`) |
| `PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anonymous/public API key |

A `.env.example` file is included in the repository as a template. Copy it to `.env` and fill in your values:

```sh
cp .env.example .env
```

> **Security reminder:** Never commit your `.env` file to version control. The `service_role` key (found in your Supabase Dashboard) must **never** be exposed in client-side code or committed to the repository. Only the `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` variables (prefixed with `PUBLIC_`) are safe for browser use.

## Database Migrations

The `supabase/migrations/` directory contains SQL migration files that set up the required database tables. Apply them in order:

| # | File | Description |
|---|---|---|
| 1 | `00001_create_users_profile.sql` | User profiles table (display name, avatar, timestamps) |
| 2 | `00002_create_user_progress.sql` | Progress tracking and session results tables |
| 3 | `00003_create_user_settings.sql` | User settings table (instrument, theme, audio preferences) |
| 4 | `00004_create_user_licks.sql` | User-recorded licks table |
| 5 | `00005_enable_rls.sql` | Row Level Security policies for all user-scoped tables |

You can apply these migrations using the **Supabase CLI**:

```sh
supabase db push
```

Alternatively, paste each file's SQL into the **Supabase Dashboard → SQL Editor** and run them in sequence.

## Multi-User Features

Mankunku supports multiple users with isolated, per-user data. Key behaviors:

- **Cross-device progress sync** — Sign in on any device to pick up exactly where you left off. Your practice sessions, adaptive difficulty state, streaks, scale/key proficiency scores, settings, and recorded licks are all synchronized.
- **Local-first data strategy** — All writes go to `localStorage` and `IndexedDB` first for instant feedback and offline resilience, then sync to the Supabase cloud database in the background. This means the app feels fast regardless of network conditions.
- **Offline practice** — You can practice, record licks, and complete sessions while fully offline. Results are stored locally and automatically sync to the cloud when connectivity returns.
- **Anonymous fallback** — If you choose not to sign in, the app works exactly as a single-device client-only PWA. No data leaves your browser.
- **Account management** — Authenticated users can manage their account from the Settings page. This includes requesting a password change (sent via email) and deactivating their account.

## Testing

Run the unit test suite with [Vitest](https://vitest.dev):

```sh
npm test
```

Run the SvelteKit type checker (includes `svelte-check` and TypeScript validation):

```sh
npm run check
```
