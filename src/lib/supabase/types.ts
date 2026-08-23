/**
 * Supabase Database Schema Types
 *
 * Generated-style type definitions for the Mankunku PostgreSQL database.
 * Follows the exact format produced by `npx supabase gen types typescript`.
 *
 * HAND-MAINTAINED — do NOT overwrite this file with generator output. Edit it
 * by hand when a migration changes the schema, then run `npm run db:types:check`
 * to confirm it matches the local database. Regenerating in place would drop the
 * source-interface mapping below, pull in the unused `graphql_public` schema,
 * and widen `public_lick_authors.id` to `string | null` (Postgres cannot prove
 * non-nullability through a view, though that column is a NOT NULL primary key
 * — see DELIBERATE_OVERRIDES in scripts/check-db-types.mjs).
 *
 * These types provide compile-time safety for all Supabase client queries.
 * Each table in the `public` schema is represented with three type variants:
 *   - Row:    The complete row shape returned by SELECT queries
 *   - Insert: The shape for INSERT operations (columns with DB defaults are optional)
 *   - Update: The shape for UPDATE operations (all columns optional for partial updates)
 *
 * Source interface → table mapping:
 *   UserProgress   (progress.ts)       → user_progress
 *   SessionResult  (progress.ts)       → session_results
 *   ScaleProficiency (progress.ts)     → scale_proficiency
 *   KeyProficiency (progress.ts)       → key_proficiency
 *   Phrase         (music.ts)          → user_licks
 *   Tune      (tune.ts)           → tunes
 *   defaultSettings (settings.svelte.ts) → user_settings
 *   (new)                              → user_profiles
 */

/**
 * Recursive JSON type for PostgreSQL JSONB columns.
 * Matches the standard Supabase generated type convention.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/**
 * Root database type representing the full Supabase PostgreSQL schema.
 * Used as the generic parameter for `createBrowserClient<Database>()`
 * and `createServerClient<Database>()`.
 */
export type Database = {
  public: {
    Tables: {
      /**
       * User profiles extending Supabase auth.users.
       * One-to-one relationship with auth.users via id.
       * Auto-created on user signup via database trigger.
       */
      user_profiles: {
        Row: {
          /** UUID primary key, references auth.users.id */
          id: string
          /** User's chosen display name */
          display_name: string | null
          /** URL to user's avatar image */
          avatar_url: string | null
          /** Admin flag — admins can delete any user lick */
          is_admin: boolean
          /** Timestamp of profile creation (ISO 8601) */
          created_at: string
          /** Timestamp of last profile update (ISO 8601) */
          updated_at: string
        }
        Insert: {
          /** UUID primary key, references auth.users.id — required on insert */
          id: string
          display_name?: string | null
          avatar_url?: string | null
          /** Defaults to false */
          is_admin?: boolean
          /** Auto-set by database default (now()) */
          created_at?: string
          /** Auto-set by database default (now()) */
          updated_at?: string
        }
        Update: {
          id?: string
          display_name?: string | null
          avatar_url?: string | null
          is_admin?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * User application settings.
       * Mirrors the Settings interface from settings.svelte.ts.
       * One row per user (unique on user_id).
       */
      user_settings: {
        Row: {
          /** UUID primary key, references auth.users.id (1:1 relationship) */
          user_id: string
          /** Instrument identifier, e.g. 'soprano-sax', 'tenor-sax', 'alto-sax', 'trumpet' */
          instrument_id: string
          /** Default BPM for practice sessions */
          default_tempo: number
          /** Master volume level (0.0–1.0) */
          master_volume: number
          /** Whether the metronome is enabled during practice */
          metronome_enabled: boolean
          /** Metronome volume level (0.0–1.0) */
          metronome_volume: number
          /** Whether the backing track is enabled during practice */
          backing_track_enabled: boolean
          /** Comping instrument for the backing track: 'piano' or 'organ' */
          backing_instrument: string
          /** Backing track volume level (0.0–1.0) */
          backing_track_volume: number
          /** Swing amount (0.5 = straight, up to 0.8 = heavy swing) */
          swing: number
          /** UI theme: 'dark' or 'light' */
          theme: string
          /** Whether the user has completed the onboarding wizard */
          onboarding_complete: boolean
          /** Optional tonality override as JSONB (Tonality object or null) */
          tonality_override: Json | null
          /** User-configured highest concert pitch MIDI. NULL = instrument default. */
          highest_note: number | null
          /** Guided tour completion state: { completed: string[], dismissed: string[] } */
          tour_state: Json
          /** Backing-track feel: swing|bossa-nova|ballad|straight. NULL = 'swing'. */
          backing_style: string | null
          /** A/B toggle: use bleed-filtered notes as primary score. NULL = false. */
          bleed_filter_enabled: boolean | null
          /** Trick practice state: { selectedVariants, selectedUpdatedAt, migrations, progress, unlockCounts, history } */
          trick_state: Json
          /** Timestamp of last settings update (ISO 8601) */
          updated_at: string
        }
        Insert: {
          /** UUID primary key, references auth.users.id — required */
          user_id: string
          /** Defaults to 'tenor-sax' in database */
          instrument_id?: string
          /** Defaults to 100 in database */
          default_tempo?: number
          /** Defaults to 0.8 in database */
          master_volume?: number
          /** Defaults to true in database */
          metronome_enabled?: boolean
          /** Defaults to 0.7 in database */
          metronome_volume?: number
          /** Defaults to true in database */
          backing_track_enabled?: boolean
          /** Defaults to 'piano' in database */
          backing_instrument?: string
          /** Defaults to 0.6 in database */
          backing_track_volume?: number
          /** Defaults to 0.5 in database */
          swing?: number
          /** Defaults to 'dark' in database */
          theme?: string
          /** Defaults to false in database */
          onboarding_complete?: boolean
          tonality_override?: Json | null
          /** NULL = instrument default */
          highest_note?: number | null
          /** Defaults to {} in database */
          tour_state?: Json
          /** NULL = 'swing' */
          backing_style?: string | null
          /** NULL = false */
          bleed_filter_enabled?: boolean | null
          /** Defaults to {} in database */
          trick_state?: Json
          updated_at?: string
        }
        Update: {
          user_id?: string
          instrument_id?: string
          default_tempo?: number
          master_volume?: number
          metronome_enabled?: boolean
          metronome_volume?: number
          backing_track_enabled?: boolean
          backing_instrument?: string
          backing_track_volume?: number
          swing?: number
          theme?: string
          onboarding_complete?: boolean
          tonality_override?: Json | null
          highest_note?: number | null
          tour_state?: Json
          backing_style?: string | null
          bleed_filter_enabled?: boolean | null
          trick_state?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * Aggregate user progress data.
       * Mirrors the UserProgress interface from progress.ts.
       * One row per user (unique on user_id).
       * Complex nested objects stored as JSONB.
       */
      user_progress: {
        Row: {
          /** UUID primary key, references auth.users.id (1:1 relationship) */
          user_id: string
          /** JSONB storing AdaptiveState: currentLevel, pitchComplexity, rhythmComplexity, recentScores, recentPitchScores, recentRhythmScores, attemptsAtLevel, attemptsSinceChange, pitchAttemptsSinceChange, rhythmAttemptsSinceChange */
          adaptive_state: Json
          /** JSONB storing Record<string, CategoryProgress> with per-category attempt and score tracking */
          category_progress: Json
          /** JSONB storing Partial<Record<PitchClass, { attempts: number; averageScore: number }>> */
          key_progress: Json
          /** Total practice time in seconds */
          total_practice_time: number
          /** Current practice streak in days */
          streak_days: number
          /** ISO date string of last practice session, empty string if never practiced */
          last_practice_date: string
          /** Timestamp of last progress update (ISO 8601) */
          updated_at: string
        }
        Insert: {
          /** UUID primary key, references auth.users.id — required */
          user_id: string
          /** JSONB — required on first insert to initialize adaptive state */
          adaptive_state: Json
          /** JSONB — required on first insert */
          category_progress: Json
          /** JSONB — required on first insert */
          key_progress: Json
          /** Defaults to 0 in database */
          total_practice_time?: number
          /** Defaults to 0 in database */
          streak_days?: number
          /** Defaults to '' in database */
          last_practice_date?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          adaptive_state?: Json
          category_progress?: Json
          key_progress?: Json
          total_practice_time?: number
          streak_days?: number
          last_practice_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * Individual practice session results.
       * Mirrors the SessionResult interface from progress.ts.
       * Many rows per user, capped at 200 (matching MAX_SESSIONS).
       */
      session_results: {
        Row: {
          /** UUID primary key */
          id: string
          /** UUID foreign key to auth.users.id */
          user_id: string
          /** Reference to the phrase that was practiced */
          phrase_id: string
          /** Display name of the practiced phrase */
          phrase_name: string
          /** PhraseCategory value (e.g. 'ii-V-I-major', 'blues', 'bebop-lines', 'user') */
          category: string
          /** PitchClass value for the session key (e.g. 'C', 'Db', 'Bb') */
          key: string
          /** ScaleType identifier, optional for backward compatibility */
          scale_type: string | null
          /** Practice tempo in BPM */
          tempo: number
          /** Difficulty level (1–100) */
          difficulty_level: number
          /** Pitch accuracy score (0.0–1.0) */
          pitch_accuracy: number
          /** Rhythm accuracy score (0.0–1.0) */
          rhythm_accuracy: number
          /** Overall combined score (0.0–1.0) */
          overall: number
          /** Grade: 'perfect' | 'great' | 'good' | 'fair' | 'try-again' */
          grade: string
          /** Number of notes correctly identified */
          notes_hit: number
          /** Total number of expected notes */
          notes_total: number
          /** JSONB storing NoteResult[] — per-note scoring breakdown */
          note_results: Json
          /** JSONB storing TimingDiagnostics — bias, spread, per-note offsets. Nullable for backward compat. */
          timing: Json | null
          /** Unix timestamp in milliseconds from original SessionResult.timestamp */
          timestamp: number
          /** Session origin: 'ear-training' | 'lick-practice'. Nullable — NULL reads as 'ear-training'. */
          source: string | null
        }
        Insert: {
          /** TEXT primary key — generated client-side as ${Date.now()}-${random}, required on insert */
          id: string
          /** UUID foreign key to auth.users.id — required */
          user_id: string
          phrase_id: string
          phrase_name: string
          category: string
          key: string
          /** Optional for backward compatibility */
          scale_type?: string | null
          tempo: number
          difficulty_level: number
          pitch_accuracy: number
          rhythm_accuracy: number
          overall: number
          grade: string
          notes_hit: number
          notes_total: number
          /** JSONB — required, stores NoteResult[] */
          note_results: Json
          /** JSONB — optional, stores TimingDiagnostics */
          timing?: Json | null
          timestamp: number
          /** Optional — 'ear-training' | 'lick-practice'; omitted reads as 'ear-training' */
          source?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          phrase_id?: string
          phrase_name?: string
          category?: string
          key?: string
          scale_type?: string | null
          tempo?: number
          difficulty_level?: number
          pitch_accuracy?: number
          rhythm_accuracy?: number
          overall?: number
          grade?: string
          notes_hit?: number
          notes_total?: number
          note_results?: Json
          timing?: Json | null
          timestamp?: number
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * Per-scale proficiency tracking.
       * Mirrors the ScaleProficiency interface from progress.ts.
       * Unique constraint on (user_id, scale_id).
       */
      scale_proficiency: {
        Row: {
          /** UUID foreign key to auth.users.id — part of composite PK (user_id, scale_id) */
          user_id: string
          /** ScaleType identifier (e.g. 'dorian', 'major', 'mixolydian') — part of composite PK */
          scale_id: string
          /** Proficiency level (1–100) */
          level: number
          /** PostgreSQL INTEGER[] — circular buffer of last 10 scores at current level */
          recent_scores: number[]
          /** Number of attempts at the current proficiency level */
          attempts_at_level: number
          /** Number of attempts since last difficulty change */
          attempts_since_change: number
          /** Total number of attempts for this scale */
          total_attempts: number
        }
        Insert: {
          /** UUID foreign key to auth.users.id — required, part of composite PK */
          user_id: string
          /** ScaleType identifier — required, part of composite PK */
          scale_id: string
          level: number
          /** PostgreSQL INTEGER[] — required */
          recent_scores: number[]
          attempts_at_level: number
          attempts_since_change: number
          total_attempts: number
        }
        Update: {
          user_id?: string
          scale_id?: string
          level?: number
          recent_scores?: number[]
          attempts_at_level?: number
          attempts_since_change?: number
          total_attempts?: number
        }
        Relationships: [
          {
            foreignKeyName: "scale_proficiency_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * Per-key proficiency tracking.
       * Mirrors the KeyProficiency interface from progress.ts.
       * Unique constraint on (user_id, key).
       */
      key_proficiency: {
        Row: {
          /** UUID foreign key to auth.users.id — part of composite PK (user_id, key) */
          user_id: string
          /** PitchClass value: 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F' | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B' — part of composite PK */
          key: string
          /** Proficiency level (1–100) */
          level: number
          /** PostgreSQL INTEGER[] — circular buffer of last 10 scores at current level */
          recent_scores: number[]
          /** Number of attempts at the current proficiency level */
          attempts_at_level: number
          /** Number of attempts since last difficulty change */
          attempts_since_change: number
          /** Total number of attempts for this key */
          total_attempts: number
        }
        Insert: {
          /** UUID foreign key to auth.users.id — required, part of composite PK */
          user_id: string
          /** PitchClass value — required, part of composite PK */
          key: string
          level: number
          /** PostgreSQL INTEGER[] — required */
          recent_scores: number[]
          attempts_at_level: number
          attempts_since_change: number
          total_attempts: number
        }
        Update: {
          user_id?: string
          key?: string
          level?: number
          recent_scores?: number[]
          attempts_at_level?: number
          attempts_since_change?: number
          total_attempts?: number
        }
        Relationships: [
          {
            foreignKeyName: "key_proficiency_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * Per-day practice aggregates for calendar / trend / period views.
       * Mirrors the DailySummary interface from progress.ts.
       * Composite PK on (user_id, date). `date` is local YYYY-MM-DD.
       */
      daily_summaries: {
        Row: {
          /** UUID foreign key to auth.users.id — part of composite PK */
          user_id: string
          /** Local YYYY-MM-DD date string — part of composite PK */
          date: string
          /** Total scored attempts (ear-training + lick-practice) */
          session_count: number
          /** Scored ear-training attempts on this date */
          ear_training_sessions: number
          /** Scored lick-practice key attempts on this date */
          lick_practice_sessions: number
          /** Estimated practice minutes */
          practice_minutes: number
          /** Average overall score (0.0–1.0) across all attempts on this date */
          avg_overall: number
          /** Average pitch accuracy (0.0–1.0) */
          avg_pitch: number
          /** Average rhythm accuracy (0.0–1.0) */
          avg_rhythm: number
          /** Highest single-attempt overall score (0.0–1.0) */
          best_score: number
          /** Total expected notes summed across all attempts */
          notes_total: number
          /** Total notes hit summed across all attempts */
          notes_hit: number
          /** JSONB GradeDistribution { perfect, great, good, fair, tryAgain } */
          grades: Json
          /** JSONB Record<PhraseCategory, number> — count per category */
          categories: Json
          /** Snapshot of adaptive pitchComplexity at end of day. Nullable. */
          pitch_complexity: number | null
          /** Snapshot of adaptive rhythmComplexity at end of day. Nullable. */
          rhythm_complexity: number | null
          /** Snapshot of Tonal Mastery (avg proficiency across scales + keys, 0-100). Nullable. */
          tonal_mastery: number | null
          /** Last modification timestamp — used for sync conflict resolution */
          updated_at: string
        }
        Insert: {
          user_id: string
          date: string
          session_count?: number
          ear_training_sessions?: number
          lick_practice_sessions?: number
          practice_minutes?: number
          avg_overall?: number
          avg_pitch?: number
          avg_rhythm?: number
          best_score?: number
          notes_total?: number
          notes_hit?: number
          grades?: Json
          categories?: Json
          pitch_complexity?: number | null
          rhythm_complexity?: number | null
          tonal_mastery?: number | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          date?: string
          session_count?: number
          ear_training_sessions?: number
          lick_practice_sessions?: number
          practice_minutes?: number
          avg_overall?: number
          avg_pitch?: number
          avg_rhythm?: number
          best_score?: number
          notes_total?: number
          notes_hit?: number
          grades?: Json
          categories?: Json
          pitch_complexity?: number | null
          rhythm_complexity?: number | null
          tonal_mastery?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_summaries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * Thumbs-up relation between users and licks (community feature).
       * Composite PK (user_id, lick_id) enforces idempotent favoriting.
       * ON DELETE CASCADE on lick_id removes favorites when the author
       * deletes the underlying lick.
       */
      lick_favorites: {
        Row: {
          /** UUID foreign key to auth.users.id — part of composite PK */
          user_id: string
          /** TEXT foreign key to user_licks.id — part of composite PK */
          lick_id: string
          /** Timestamp of favorite creation (ISO 8601) */
          created_at: string
        }
        Insert: {
          /** UUID foreign key to auth.users.id — required, part of composite PK */
          user_id: string
          /** TEXT foreign key to user_licks.id — required, part of composite PK */
          lick_id: string
          /** Auto-set by database default (now()) */
          created_at?: string
        }
        Update: {
          user_id?: string
          lick_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lick_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lick_favorites_lick_id_fkey"
            columns: ["lick_id"]
            isOneToOne: false
            referencedRelation: "user_licks"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * Live-reference adoptions of community licks (community feature).
       * Composite PK (user_id, lick_id) enforces idempotent adoption.
       * ON DELETE CASCADE on lick_id removes adoptions when the author
       * deletes the underlying lick (live-delete semantics).
       * Self-adoption is blocked by the INSERT RLS policy.
       */
      lick_adoptions: {
        Row: {
          /** UUID foreign key to auth.users.id — part of composite PK */
          user_id: string
          /** TEXT foreign key to user_licks.id — part of composite PK */
          lick_id: string
          /** Timestamp of adoption (ISO 8601) */
          adopted_at: string
        }
        Insert: {
          /** UUID foreign key to auth.users.id — required, part of composite PK */
          user_id: string
          /** TEXT foreign key to user_licks.id — required, part of composite PK */
          lick_id: string
          /** Auto-set by database default (now()) */
          adopted_at?: string
        }
        Update: {
          user_id?: string
          lick_id?: string
          adopted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lick_adoptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lick_adoptions_lick_id_fkey"
            columns: ["lick_id"]
            isOneToOne: false
            referencedRelation: "user_licks"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * Per-user lick practice metadata for cross-device sync.
       * Stores practice tags, progression tags, per-key tempo/pass history,
       * and curated lick overrides as JSONB blobs. One row per user.
       */
      user_lick_metadata: {
        Row: {
          /** UUID primary key, references auth.users.id (1:1 relationship) */
          user_id: string
          /** JSONB storing Record<phraseId, string[]> — practice + progression tags */
          lick_tags: Json
          /** JSONB storing LickPracticeProgress — per-lick per-key tempo/pass data */
          practice_progress: Json
          /** JSONB storing Record<lickId, string[]> — tag overrides for curated licks */
          tag_overrides: Json
          /** JSONB storing Record<lickId, PhraseCategory> — category overrides for curated licks */
          category_overrides: Json
          /** JSONB storing Record<lickId, number> — gradual key-unlock count (1-12) per lick */
          unlock_counts: Json
          /** JSONB storing Record<lickId, LickProgressPoint[]> — append-only per-lick BPM/keys time series */
          progress_history: Json
          /** JSONB per-entry merge metadata (tags/overrides/catOverrides/progressResets/unlockResets → id→mtime). Defaults to {}. */
          merge_meta: Json
          /** Timestamp of last update (ISO 8601) */
          updated_at: string
        }
        Insert: {
          /** UUID primary key, references auth.users.id — required */
          user_id: string
          /** Defaults to '{}' in database */
          lick_tags?: Json
          /** Defaults to '{}' in database */
          practice_progress?: Json
          /** Defaults to '{}' in database */
          tag_overrides?: Json
          /** Defaults to '{}' in database */
          category_overrides?: Json
          /** Defaults to '{}' in database */
          unlock_counts?: Json
          /** Defaults to '{}' in database */
          progress_history?: Json
          /** Defaults to '{}' in database */
          merge_meta?: Json
          updated_at?: string
        }
        Update: {
          user_id?: string
          lick_tags?: Json
          practice_progress?: Json
          tag_overrides?: Json
          category_overrides?: Json
          unlock_counts?: Json
          progress_history?: Json
          merge_meta?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_lick_metadata_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }

      /**
       * User-recorded licks/phrases.
       * Mirrors the Phrase interface from music.ts with user-specific fields.
       * Source is always 'user-recorded', category is always 'user'.
       */
      user_licks: {
        Row: {
          /** TEXT primary key — generated client-side as user-{timestamp}-{random} */
          id: string
          /** UUID foreign key to auth.users.id */
          user_id: string
          /** User-given name for the lick */
          name: string
          /** Concert pitch key as PitchClass value */
          key: string
          /** 'major' | 'minor' | null — null = not stated (legacy); the client resolves via lickMode */
          mode: 'major' | 'minor' | null
          /** PostgreSQL INTEGER[2] storing time signature tuple (e.g. [4, 4]) */
          time_signature: number[]
          /** JSONB storing Note[] array — the lick's note sequence */
          notes: Json
          /** JSONB storing HarmonicSegment[] array — chord/scale context */
          harmony: Json
          /** JSONB storing DifficultyMetadata — level, pitchComplexity, rhythmComplexity, lengthBars */
          difficulty: Json
          /** Always 'user' for user-recorded licks */
          category: string
          /** PostgreSQL text[] array of descriptive tags */
          tags: string[]
          /** Always 'user-recorded' — see user-licks.ts */
          source: string
          /** Supabase Storage URL for the associated audio recording, null if no recording */
          audio_url: string | null
          /** Timestamp of lick creation (ISO 8601) */
          created_at: string
          /** Timestamp of last lick update (ISO 8601) */
          updated_at: string
          /** Denormalized count of favorites (maintained by triggers on lick_favorites). Defaults to 0. */
          favorite_count: number
          /** Soft-delete tombstone. NULL = live. Set instead of a hard DELETE so deletes propagate. */
          deleted_at: string | null
          /** Client-owned edit clock (ms). NOT touched by the updated_at trigger; the field the merge compares. Defaults to 0. */
          client_mtime: number
        }
        Insert: {
          /** TEXT primary key — generated client-side as user-{timestamp}-{random}, required on insert */
          id: string
          /** UUID foreign key to auth.users.id — required */
          user_id: string
          name: string
          key: string
          mode?: 'major' | 'minor' | null
          /** PostgreSQL INTEGER[2] — required, stores time signature tuple */
          time_signature: number[]
          /** JSONB — required, stores Note[] */
          notes: Json
          /** JSONB — required, stores HarmonicSegment[] */
          harmony: Json
          /** JSONB — required, stores DifficultyMetadata */
          difficulty: Json
          /** Defaults to 'user' in database */
          category?: string
          /** Defaults to empty array in database */
          tags?: string[]
          /** Defaults to 'user-recorded' in database */
          source?: string
          audio_url?: string | null
          created_at?: string
          updated_at?: string
          /** Defaults to 0 in database; maintained by triggers on lick_favorites. Do not set manually. */
          favorite_count?: number
          /** NULL = live; set to a timestamp to tombstone */
          deleted_at?: string | null
          /** Client edit clock (ms). Defaults to 0. */
          client_mtime?: number
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          key?: string
          mode?: 'major' | 'minor' | null
          time_signature?: number[]
          notes?: Json
          harmony?: Json
          difficulty?: Json
          category?: string
          tags?: string[]
          source?: string
          audio_url?: string | null
          created_at?: string
          updated_at?: string
          /** Maintained by triggers; do not set manually. */
          favorite_count?: number
          deleted_at?: string | null
          client_mtime?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_licks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      /**
       * User-owned tunes (melody + full-harmony song forms).
       * Local-first: ids are client-generated TEXT (sheet-{timestamp}-{random})
       * so offline-created rows keep their id on first sync. Mirrors
       * user_licks' sync model (client_mtime clock + deleted_at tombstones).
       */
      tunes: {
        Row: {
          /** TEXT primary key — generated client-side as sheet-{timestamp}-{random} */
          id: string
          /** UUID foreign key to auth.users.id */
          user_id: string
          /** Tune title */
          title: string
          /** Composer credit, nullable */
          composer: string | null
          /** Concert pitch key as PitchClass value */
          key: string
          /** PostgreSQL INTEGER[2] storing time signature tuple (e.g. [4, 4]) */
          time_signature: number[]
          /** Feel/style label (e.g. 'Medium Swing'), nullable */
          style: string | null
          /** PostgreSQL text[] array of descriptive tags */
          tags: string[]
          /** JSONB storing TuneSection[] — labels, bars, repeats/endings, notes, harmony */
          sections: Json
          /** JSONB storing DifficultyMetadata, nullable */
          difficulty: Json | null
          /** Origin discriminator: 'user' | 'imported-ireal' | 'imported-biab' | 'imported-pdf' */
          source: string
          /** Storage path of the original imported PDF ({uid}/{id}.pdf in the tunes bucket), nullable */
          pdf_url: string | null
          /** Denormalized count of favorites (maintained by triggers on tune_favorites). Defaults to 0. */
          favorite_count: number
          /** Soft-delete tombstone. NULL = live. Set instead of a hard DELETE so deletes propagate. */
          deleted_at: string | null
          /** Client-owned edit clock (ms). NOT touched by the updated_at trigger; the field the merge compares. Defaults to 0. */
          client_mtime: number
          /** Timestamp of sheet creation (ISO 8601) */
          created_at: string
          /** Timestamp of last sheet update (ISO 8601) */
          updated_at: string
        }
        Insert: {
          /** TEXT primary key — generated client-side, required on insert */
          id: string
          /** UUID foreign key to auth.users.id — required */
          user_id: string
          title: string
          composer?: string | null
          key: string
          /** PostgreSQL INTEGER[2] — required, stores time signature tuple */
          time_signature: number[]
          style?: string | null
          /** Defaults to empty array in database */
          tags?: string[]
          /** JSONB — defaults to empty array in database */
          sections?: Json
          difficulty?: Json | null
          /** Defaults to 'user' in database */
          source?: string
          pdf_url?: string | null
          /** Defaults to 0 in database; maintained by triggers on tune_favorites. Do not set manually. */
          favorite_count?: number
          /** NULL = live; set to a timestamp to tombstone */
          deleted_at?: string | null
          /** Client edit clock (ms). Defaults to 0. */
          client_mtime?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          composer?: string | null
          key?: string
          time_signature?: number[]
          style?: string | null
          tags?: string[]
          sections?: Json
          difficulty?: Json | null
          source?: string
          pdf_url?: string | null
          /** Maintained by triggers; do not set manually. */
          favorite_count?: number
          deleted_at?: string | null
          client_mtime?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tunes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      /**
       * Thumbs-up relation between users and lead sheets (community feature).
       * Composite PK (user_id, tune_id) enforces idempotent favoriting.
       * ON DELETE CASCADE on tune_id removes favorites when the author
       * deletes the underlying sheet. No UPDATE policy on purpose.
       */
      tune_favorites: {
        Row: {
          /** UUID foreign key to auth.users.id — part of composite PK */
          user_id: string
          /** TEXT foreign key to tunes.id — part of composite PK */
          tune_id: string
          /** Timestamp of favorite creation (ISO 8601) */
          created_at: string
        }
        Insert: {
          /** UUID foreign key to auth.users.id — required, part of composite PK */
          user_id: string
          /** TEXT foreign key to tunes.id — required, part of composite PK */
          tune_id: string
          /** Auto-set by database default (now()) */
          created_at?: string
        }
        Update: {
          user_id?: string
          tune_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tune_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tune_favorites_tune_id_fkey"
            columns: ["tune_id"]
            isOneToOne: false
            referencedRelation: "tunes"
            referencedColumns: ["id"]
          }
        ]
      }
      /**
       * Add-to-my-library relation for community lead sheets. Adoption is a
       * live reference, not a copy — the payload stays in tunes, so an
       * author delete cascades to adopters. Fully owner-scoped RLS (including
       * SELECT); self-adoption blocked in the INSERT policy's WITH CHECK.
       */
      tune_adoptions: {
        Row: {
          /** UUID foreign key to auth.users.id — part of composite PK */
          user_id: string
          /** TEXT foreign key to tunes.id — part of composite PK */
          tune_id: string
          /** Timestamp of adoption (ISO 8601) */
          adopted_at: string
        }
        Insert: {
          /** UUID foreign key to auth.users.id — required, part of composite PK */
          user_id: string
          /** TEXT foreign key to tunes.id — required, part of composite PK */
          tune_id: string
          /** Auto-set by database default (now()) */
          adopted_at?: string
        }
        Update: {
          user_id?: string
          tune_id?: string
          adopted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tune_adoptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tune_adoptions_tune_id_fkey"
            columns: ["tune_id"]
            isOneToOne: false
            referencedRelation: "tunes"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      /**
       * Column-restricted projection of user_profiles for community
       * attribution. Readable by any authenticated user; exposes only
       * display_name and avatar_url — no timestamps or other metadata.
       */
      public_lick_authors: {
        Row: {
          /** UUID — same as auth.users.id */
          id: string
          /** User's display name, nullable */
          display_name: string | null
          /** URL to avatar image, nullable */
          avatar_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      /**
       * Column-restricted projection of user_profiles for lead-sheet
       * community attribution. Readable by any authenticated user; exposes
       * only display_name and avatar_url, and only for users with at least
       * one live shared lead sheet.
       */
      public_tune_authors: {
        Row: {
          /** UUID — same as auth.users.id */
          id: string
          /** User's display name, nullable */
          display_name: string | null
          /** URL to avatar image, nullable */
          avatar_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
