import { defineEnvVars } from '@sveltejs/kit/env';

/** Public connection settings are built into the client; secrets stay runtime-only. */
export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: { public: true, static: true },
	PUBLIC_SUPABASE_ANON_KEY: { public: true, static: true },
	ANTHROPIC_API_KEY: { schema: (value) => value },
	SUPABASE_SERVICE_ROLE_KEY: { schema: (value) => value }
});
