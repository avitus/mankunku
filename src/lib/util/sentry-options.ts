/** Preserve the app's telemetry boundary across Sentry SDK upgrades. */
export const SENTRY_COMMON_OPTIONS = {
	// beforeSendTransaction classifies local-server traces; streaming would
	// silently bypass it. Keep transaction semantics until that hook migrates.
	traceLifecycle: 'static' as const,
	// SDK 11 enables additional personal/request/AI data by default. Keep the
	// previous restrictions explicit on both server and browser clients.
	dataCollection: {
		userInfo: false,
		cookies: false,
		httpHeaders: {
			request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
			response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] }
		},
		httpBodies: [],
		urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
		genAI: { inputs: false, outputs: false },
		databaseQueryData: false,
		queues: false,
		graphQL: { document: false, variables: false }
	}
};
