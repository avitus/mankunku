/**
 * Supabase Database Schema Types
 *
 * Generated-style type definitions for the Mankunku PostgreSQL database.
 * Follows the exact format produced by `npx supabase gen types typescript`.
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
          /** Auto-set by database default (now()) */
          created_at?: string
          /** Auto-set by database default (now()) */
          updated_at?: string
        }
        Update: {
          id?: string
          display_name?: string | null
          avatar_url?: string | null
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
          /** UUID primary key, auto-generated */
          id: string
          /** UUID foreign key to auth.users.id, unique per user */
          user_id: string
          /** Instrument identifier, e.g. 'tenor-sax', 'alto-sax', 'trumpet' */
          instrument_id: string
          /** Default BPM for practice sessions */
          default_tempo: number
          /** Master volume level (0.0–1.0) */
          master_volume: number
          /** Whether the metronome is enabled during practice */
          metronome_enabled: boolean
          /** Metronome volume level (0.0–1.0) */
          metronome_volume: number
          /** Swing amount (0.5 = straight, up to 0.8 = heavy swing) */
          swing: number
          /** UI theme: 'dark' or 'light' */
          theme: string
          /** Whether the user has completed the onboarding wizard */
          onboarding_complete: boolean
          /** Optional tonality override as JSONB (Tonality object or null) */
          tonality_override: Json | null
          /** Timestamp of settings creation (ISO 8601) */
          created_at: string
          /** Timestamp of last settings update (ISO 8601) */
          updated_at: string
        }
        Insert: {
          /** Auto-generated UUID — optional on insert */
          id?: string
          /** UUID foreign key to auth.users.id — required */
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
          /** Defaults to 0.5 in database */
          swing?: number
          /** Defaults to 'dark' in database */
          theme?: string
          /** Defaults to false in database */
          onboarding_complete?: boolean
          tonality_override?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          instrument_id?: string
          default_tempo?: number
          master_volume?: number
          metronome_enabled?: boolean
          metronome_volume?: number
          swing?: number
          theme?: string
          onboarding_complete?: boolean
          tonality_override?: Json | null
          created_at?: string
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
          /** UUID primary key */
          id: string
          /** UUID foreign key to auth.users.id, unique per user */
          user_id: string
          /** JSONB storing AdaptiveState: currentLevel, pitchComplexity, rhythmComplexity, recentScores, attemptsAtLevel, attemptsSinceChange, xp */
          adaptive_state: Json
          /** JSONB storing Record<string, CategoryProgress> with per-category attempt and score tracking */
          category_progress: Json
          /** JSONB storing Partial<Record<PitchClass, { attempts: number; averageScore: number }>> */
          key_progress: Json
          /** Total practice time in seconds */
          total_practice_time: number
          /** Current practice streak in days */
          streak_days: number
          /** ISO date string of last practice session, null if never practiced */
          last_practice_date: string | null
          /** Timestamp of progress record creation (ISO 8601) */
          created_at: string
          /** Timestamp of last progress update (ISO 8601) */
          updated_at: string
        }
        Insert: {
          /** Auto-generated UUID — optional on insert */
          id?: string
          /** UUID foreign key to auth.users.id — required */
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
          last_practice_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          adaptive_state?: Json
          category_progress?: Json
          key_progress?: Json
          total_practice_time?: number
          streak_days?: number
          last_practice_date?: string | null
          created_at?: string
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
          /** Server-set timestamp of record creation (ISO 8601) */
          created_at: string
        }
        Insert: {
          /** Auto-generated UUID — optional on insert */
          id?: string
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
          /** Auto-set by database default (now()) */
          created_at?: string
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
          created_at?: string
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
          /** UUID primary key */
          id: string
          /** UUID foreign key to auth.users.id */
          user_id: string
          /** ScaleType identifier (e.g. 'dorian', 'major', 'mixolydian') */
          scale_id: string
          /** Proficiency level (1–100) */
          level: number
          /** JSONB storing integer array of last 10 scores at current level */
          recent_scores: Json
          /** Number of attempts at the current proficiency level */
          attempts_at_level: number
          /** Number of attempts since last difficulty change */
          attempts_since_change: number
          /** Total number of attempts for this scale */
          total_attempts: number
          /** Timestamp of record creation (ISO 8601) */
          created_at: string
          /** Timestamp of last update (ISO 8601) */
          updated_at: string
        }
        Insert: {
          /** Auto-generated UUID — optional on insert */
          id?: string
          /** UUID foreign key to auth.users.id — required */
          user_id: string
          /** ScaleType identifier — required */
          scale_id: string
          level: number
          /** JSONB integer array — required */
          recent_scores: Json
          attempts_at_level: number
          attempts_since_change: number
          total_attempts: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          scale_id?: string
          level?: number
          recent_scores?: Json
          attempts_at_level?: number
          attempts_since_change?: number
          total_attempts?: number
          created_at?: string
          updated_at?: string
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
          /** UUID primary key */
          id: string
          /** UUID foreign key to auth.users.id */
          user_id: string
          /** PitchClass value: 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F' | 'Gb' | 'G' | 'Ab' | 'A' | 'Bb' | 'B' */
          key: string
          /** Proficiency level (1–100) */
          level: number
          /** JSONB storing integer array of last 10 scores at current level */
          recent_scores: Json
          /** Number of attempts at the current proficiency level */
          attempts_at_level: number
          /** Number of attempts since last difficulty change */
          attempts_since_change: number
          /** Total number of attempts for this key */
          total_attempts: number
          /** Timestamp of record creation (ISO 8601) */
          created_at: string
          /** Timestamp of last update (ISO 8601) */
          updated_at: string
        }
        Insert: {
          /** Auto-generated UUID — optional on insert */
          id?: string
          /** UUID foreign key to auth.users.id — required */
          user_id: string
          /** PitchClass value — required */
          key: string
          level: number
          /** JSONB integer array — required */
          recent_scores: Json
          attempts_at_level: number
          attempts_since_change: number
          total_attempts: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          key?: string
          level?: number
          recent_scores?: Json
          attempts_at_level?: number
          attempts_since_change?: number
          total_attempts?: number
          created_at?: string
          updated_at?: string
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
       * User-recorded licks/phrases.
       * Mirrors the Phrase interface from music.ts with user-specific fields.
       * Source is always 'user-recorded', category is always 'user'.
       */
      user_licks: {
        Row: {
          /** UUID primary key */
          id: string
          /** UUID foreign key to auth.users.id */
          user_id: string
          /** User-given name for the lick */
          name: string
          /** Concert pitch key as PitchClass value */
          key: string
          /** JSONB storing [number, number] time signature tuple (e.g. [4, 4]) */
          time_signature: Json
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
        }
        Insert: {
          /** Auto-generated UUID — optional on insert */
          id?: string
          /** UUID foreign key to auth.users.id — required */
          user_id: string
          name: string
          key: string
          /** JSONB — required, stores time signature tuple */
          time_signature: Json
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
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          key?: string
          time_signature?: Json
          notes?: Json
          harmony?: Json
          difficulty?: Json
          category?: string
          tags?: string[]
          source?: string
          audio_url?: string | null
          created_at?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
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
