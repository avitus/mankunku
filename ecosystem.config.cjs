const fs = require('node:fs');

// --- Runtime secrets injection ---
//
// adapter-node reads secrets from process.env at RUNTIME and does not load
// .env files itself. Historically the only thing feeding runtime secrets to
// this process was whatever the deploy's `bash -l -c` login shell happened to
// export on the server (see .circleci/continue-config.yml) — implicit,
// undocumented, and easy to forget. The docs-assistant ANTHROPIC_API_KEY was
// unset in production for exactly this reason.
//
// Load them explicitly instead, from a git-ignored file in the deploy-durable
// `shared/` dir (outside the per-release dirs, so it survives atomic swaps).
// Create it once on the server, chmod 600:
//
//   /home/deploy/mankunku/shared/runtime.env
//     ANTHROPIC_API_KEY=sk-ant-...
//     SUPABASE_SERVICE_ROLE_KEY=...
//
// Format: one KEY=VALUE per line; blank lines and `#` comments ignored;
// optional surrounding quotes stripped. A missing/unreadable file injects
// nothing — the app degrades gracefully (chat + admin features report
// "unavailable") rather than crashing `pm2 start`.
// Path is overridable (MANKUNKU_RUNTIME_ENV_FILE) to match release.sh's
// MANKUNKU_ROOT test-override convention; production uses the default.
const RUNTIME_ENV_FILE =
	process.env.MANKUNKU_RUNTIME_ENV_FILE || '/home/deploy/mankunku/shared/runtime.env';

function loadRuntimeSecrets(file) {
	const secrets = {};
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch {
		return secrets; // file absent/unreadable — nothing to inject
	}
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		if (!key) continue;
		let value = line.slice(eq + 1).trim();
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}
		secrets[key] = value;
	}
	return secrets;
}

const runtimeSecrets = loadRuntimeSecrets(RUNTIME_ENV_FILE);

module.exports = {
	apps: [
		{
			name: 'mankunku',
			// Absolute script path so PM2's `pm_exec_path = path.resolve(cwd, script)`
			// doesn't depend on `cwd` being right — `path.resolve` with an absolute
			// second arg ignores the first. The `/current/` symlink resolves at
			// fs.existsSync time, pinning the process to the live release dir.
			script: '/home/deploy/mankunku/current/build/index.js',
			cwd: '/home/deploy/mankunku/current',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			max_restarts: 10,
			restart_delay: 1000,
			watch: false,
			env_production: {
				// Runtime secrets (ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, …)
				// loaded from the git-ignored shared file above. Spread FIRST so the
				// operational config below is always authoritative (a stray PORT or
				// ORIGIN in the secrets file can't override deploy config). Keys not
				// present in the file still fall through from the inherited
				// login-shell env, so this stays backward-compatible.
				...runtimeSecrets,
				NODE_ENV: 'production',
				PORT: 3000,
				ORIGIN: 'https://mankunkujazz.com',
				PROTOCOL_HEADER: 'x-forwarded-proto',
				// Raise from adapter-node's 512K default so (a) the Sentry replay
				// tunnel at /api/monitoring can receive ~1MB envelopes and (b) the
				// lead-sheet PDF import at /api/tune-parse can receive a
				// base64-encoded 10MB PDF (~13.4MB JSON). Each route's own byte
				// constant (MAX_ENVELOPE_SIZE_BYTES 1MB / MAX_PDF_REQUEST_BYTES
				// 15MB) is the real gate. PM2 needs delete+start (not restart)
				// to pick this up.
				BODY_SIZE_LIMIT: '16M'
			}
		}
	]
};
