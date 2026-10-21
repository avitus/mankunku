import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Never copy credentials, generated state, or nested worktrees into the image.
 * @param {string} file
 */
export function includeInSnapshot(file) {
	// Generated root output is distinct from source such as tests/unit/build/.
	if (['.svelte-kit', 'build', 'test-results', 'playwright-report'].includes(file.split('/')[0])) return false;
	return !file.split('/').some((part) =>
		['.git', '.claude', '.codex', '.chunk', '.npmrc', 'node_modules',
			'.venv', '__pycache__', '.auth', '.temp'].includes(part) ||
		(part.startsWith('.env') && part !== '.env.example') ||
		/\.(pem|key|p12|pfx)$/i.test(part));
}

/** Resolve browser binaries from the lockfile, never the semver range.
 * @param {{packages?: Record<string, {version?: string}>}} lock
 */
export function playwrightVersion(lock) {
	const version = lock.packages?.['node_modules/@playwright/test']?.version;
	if (!/^\d+\.\d+\.\d+$/.test(version ?? '') ||
		lock.packages?.['node_modules/playwright-core']?.version !== version) {
		throw new Error('The lockfile must resolve matching Playwright test and browser versions.');
	}
	return version;
}

/** Build an argv array so test names and regular expressions remain literal.
 * @param {string} mode
 * @param {string[]} args
 */
export function testCommand(mode, args) {
	if (args.some((arg) => /^(--debug|--ui(?:-host|-port)?)(=|$)/.test(arg))) {
		throw new Error('Use npm run test:e2e:ui for browser debugging inside the sandbox.');
	}
	switch (mode) {
		case 'e2e': return ['xvfb-run', '-a', 'npx', 'playwright', 'test', '--workers=2', ...args];
		case 'ui': return ['xvfb-run', '-a', 'npx', 'playwright', 'test', '--workers=2',
			'--ui-host=0.0.0.0', '--ui-port=9323', ...args];
		case 'unit': return ['npx', 'vitest', 'run', '--maxWorkers=2', ...args];
		case 'check': return ['npm', 'run', 'check', '--', ...args];
		case 'deploy': return ['npm', 'run', 'test:deploy', '--', ...args];
		default: throw new Error('Usage: npm run test:sandbox -- <e2e|ui|unit|check|deploy> [runner arguments]');
	}
}

/** Run a process without a shell and preserve its exit status.
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [options]
 * @returns {Promise<number>}
 */
function execute(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
		child.on('error', reject);
		child.on('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143)));
	});
}

/** Snapshot the current worktree, run it without host mounts, then recover diagnostics. */
async function main() {
	const [mode = 'e2e', ...args] = process.argv.slice(2);
	const command = testCommand(mode, args);
	// CI and a sandbox's npm scripts already execute behind the boundary.
	if (process.platform === 'linux' &&
		((existsSync('/.dockerenv') && process.env.MANKUNKU_TEST_SANDBOX === '1') || process.env.CIRCLECI === 'true')) {
		return execute(command[0], command.slice(1));
	}
	let context = process.env.MANKUNKU_DOCKER_CONTEXT;
	if (!context && !process.env.DOCKER_CONTEXT && !process.env.DOCKER_HOST &&
		spawnSync('docker', ['context', 'inspect', 'colima-mankunku-tests'], { stdio: 'ignore', timeout: 15_000 }).status === 0) {
		context = 'colima-mankunku-tests';
	}
	const dockerArgs = context ? ['--context', context] : [];
	/** @param {...string} args */
	const docker = (...args) => execute('docker', [...dockerArgs, ...args]);
	const available = spawnSync('docker', [...dockerArgs, 'info', '--format', '{{.OSType}}'], { encoding: 'utf8', timeout: 15_000 });
	if (available.status !== 0 || available.stdout.trim() !== 'linux') {
		throw new Error('A running Linux Docker engine is required; browser tests never fall back to the host. See tests/e2e/README.md for setup.');
	}
	const version = playwrightVersion(JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8')));
	const snapshot = await mkdtemp(path.join(tmpdir(), 'mankunku-test-'));
	const name = `mankunku-test-${randomUUID()}`;
	const artifacts = path.join(root, 'test-results', 'sandbox', name);
	// CircleCI Smarter Testing expects these files at the paths it allocated on
	// the caller. Give the container private paths, then copy each result back.
	const outputs = [
		['PLAYWRIGHT_JUNIT_OUTPUT_FILE', 'junit.xml'],
		['CIRCLECI_COVERAGE', 'coverage.json']
	].filter(([variable]) => process.env[variable]);
	let created = false;
	let interrupted = 0;
	const buildAbort = new AbortController();
	/** @param {string} signal */
	const stop = (signal) => {
		interrupted = signal === 'SIGINT' ? 130 : 143;
		if (created) void docker('stop', '--time', '5', name).catch(() => {});
		else buildAbort.abort();
	};
	/** Stop this run on a terminal interruption. */
	const onInt = () => stop('SIGINT');
	/** Stop this run when its calling agent or process terminates. */
	const onTerm = () => stop('SIGTERM');
	process.on('SIGINT', onInt);
	process.on('SIGTERM', onTerm);
	try {
		const files = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
			{ cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
		if (files.status !== 0) throw new Error('Could not enumerate the current Git worktree.');
		for (const file of new Set(files.stdout.split('\0').filter(Boolean).filter(includeInSnapshot))) {
			const source = path.join(root, file);
			const stat = await lstat(source).catch((error) => {
				if (error.code === 'ENOENT') return null; // Uncommitted deletion.
				throw error;
			});
			if (!stat) continue;
			if (!stat.isFile()) throw new Error(`Sandbox snapshots require regular files: ${file}`);
			await mkdir(path.dirname(path.join(snapshot, file)), { recursive: true });
			await cp(source, path.join(snapshot, file));
		}
		// Preserve engine checks without forwarding a developer's registry credentials.
		await writeFile(path.join(snapshot, '.npmrc'), 'engine-strict=true\n');
		// No build context can accidentally include host dependencies or .env files.
		const imageFile = path.join(snapshot, 'image-id');
		if (interrupted) return interrupted;
		if (await execute('docker', [...dockerArgs, 'build', '--progress=plain', '--build-arg', `PLAYWRIGHT_VERSION=${version}`,
			'--file', path.join(snapshot, 'scripts/test-sandbox/Dockerfile'),
			'--iidfile', imageFile, snapshot], { signal: buildAbort.signal })) throw new Error('Sandbox image build failed.');
		if (interrupted) return interrupted;
		const image = (await readFile(imageFile, 'utf8')).trim();
		const ports = mode === 'ui' ? ['--publish', '127.0.0.1::9323'] : [];
		const environment = outputs.flatMap(([variable, file]) => ['--env', `${variable}=/workspace/test-results/${file}`]);
		if (process.env.E2E_SOURCEMAPS === '1') environment.push('--env', 'E2E_SOURCEMAPS=1');
		if (await docker('create', '--name', name, '--init', '--cpus=2', '--memory=4g',
			'--memory-swap=4g', '--shm-size=1g', '--pids-limit=512', '--cap-drop=ALL',
			'--security-opt=no-new-privileges', ...ports, ...environment, image, ...command)) {
			throw new Error('Could not create the test container.');
		}
		created = true;
		if (interrupted) return interrupted;
		await mkdir(artifacts, { recursive: true });
		await writeFile(path.join(artifacts, 'run.json'), JSON.stringify({ image, mode, args }, null, 2) + '\n');
		if (mode === 'ui') {
			// Start first to allocate the ephemeral localhost port; never open a host browser.
			if (await docker('start', name)) throw new Error('Could not start the UI container.');
			console.log('Open the following localhost address manually to use Playwright UI:');
			await docker('port', name, '9323');
			await docker('logs', '--follow', name);
			const status = spawnSync('docker', [...dockerArgs, 'inspect', '--format', '{{.State.ExitCode}}', name], { encoding: 'utf8' });
			return interrupted || (status.status === 0 ? Number(status.stdout.trim()) : 1);
		}
		const status = await docker('start', '--attach', name);
		return interrupted || status;
	} catch (error) {
		if (interrupted) return interrupted;
		throw error;
	} finally {
		if (created) {
			await docker('stop', '--time', '5', name);
			await mkdir(artifacts, { recursive: true });
			let copyFailed = false;
			for (const directory of ['test-results', 'playwright-report']) {
				if (await docker('cp', `${name}:/workspace/${directory}`, artifacts)) copyFailed = true;
			}
			for (const [variable, file] of outputs) {
				const destination = path.resolve(process.env[variable] ?? '');
				await mkdir(path.dirname(destination), { recursive: true });
				if (await docker('cp', `${name}:/workspace/test-results/${file}`, destination)) copyFailed = true;
			}
			console.log(`Sandbox artifacts: ${artifacts}`);
			if (copyFailed) console.error(`Artifact recovery failed; container retained: ${name}`);
			else await docker('rm', name);
		}
		await rm(snapshot, { recursive: true, force: true });
		process.off('SIGINT', onInt);
		process.off('SIGTERM', onTerm);
	}
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().then((code) => { process.exitCode = code; }).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
