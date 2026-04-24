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
				NODE_ENV: 'production',
				PORT: 3000,
				ORIGIN: 'https://mankunkujazz.com',
				PROTOCOL_HEADER: 'x-forwarded-proto'
			}
		}
	]
};
