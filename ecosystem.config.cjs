module.exports = {
	apps: [
		{
			name: 'mankunku',
			script: './build/index.js',
			cwd: '/home/deploy/mankunku',
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
