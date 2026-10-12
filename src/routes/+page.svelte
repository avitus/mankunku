<script lang="ts">
	import {
		progress,
		getRecentSessions,
		getTonalMastery,
		getUnlockContext
	} from '$lib/state/progress.svelte';
	import { lickPractice, hydrateLickPracticeProgress } from '$lib/state/lick-practice.svelte';
	import { getEffectivePracticeLickIds } from '$lib/persistence/lick-practice-store';
	import { getAllLicks } from '$lib/phrases/library-loader';
	import { masteryDisplay } from '$lib/difficulty/display';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { getTodaysTonality, formatTonality } from '$lib/tonality/tonality';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import StudioPage from '$lib/components/console/StudioPage.svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import StudioMeter from '$lib/components/console/StudioMeter.svelte';
	import HomeLanding from '$lib/components/home/HomeLanding.svelte';
	import SeoHead from '$lib/components/seo/SeoHead.svelte';
	import TooltipHint from '$lib/components/ui/TooltipHint.svelte';
	import { tooltips } from '$lib/content/tooltips';

	// Make sure lick-practice progress is loaded — the /lick-practice page
	// also calls this on its own mount, but the home page needs the data
	// for its stat lines. Cloud-backed mode requires both the client and a
	// session; the gate lives inside hydrateLickPracticeProgress.
	if (browser) {
		hydrateLickPracticeProgress(page.data?.supabase ?? null, page.data?.session ?? null);
	}

	const session = $derived(page.data?.session ?? null);
	const user = $derived(page.data?.user ?? null);
	const isAuthenticated = $derived(!!session);

	// ── Greeting ─────────────────────────────────────────────────────
	function getGreeting(): string {
		const h = new Date().getHours();
		if (h < 12) return 'Morning';
		if (h < 18) return 'Afternoon';
		return 'Evening';
	}
	const greeting = getGreeting();
	const firstName = $derived.by(() => {
		if (!user?.email) return '';
		// Best-effort first name from the local part of the email,
		// stripping any digits / dots / common separators.
		const local = user.email.split('@')[0];
		const word = local.split(/[._\-+0-9]/).filter(Boolean)[0] ?? local;
		return word.charAt(0).toUpperCase() + word.slice(1);
	});

	// ── Ear Training panel data ──────────────────────────────────────
	const mastery = $derived(getTonalMastery());
	const levelDisp = $derived(masteryDisplay(mastery.overall));
	const recentSessions = $derived(getRecentSessions(1));
	const lastSession = $derived(recentSessions[0] ?? null);

	const todaysTonality = $derived.by(() => {
		try {
			return getTodaysTonality(getUnlockContext());
		} catch {
			return null;
		}
	});
	const todaysTonalityLabel = $derived(
		todaysTonality ? formatTonality(todaysTonality, getInstrument()) : ''
	);

	const hasEarTrainingHistory = $derived(progress.sessions.length > 0);

	// ── Lick Practice panel data ─────────────────────────────────────
	const taggedLickIds = $derived.by(() => {
		// Re-derive when lickPractice.progress changes (which happens after
		// hydration) — accessing the runes state inside the derivation
		// makes Svelte track the dependency.
		void lickPractice.progress;
		return getEffectivePracticeLickIds(getAllLicks());
	});
	const taggedLickCount = $derived(taggedLickIds.size);

	const bestLickTempo = $derived.by(() => {
		let best = 0;
		for (const id of taggedLickIds) {
			const keyProgress = lickPractice.progress[id];
			if (!keyProgress) continue;
			for (const kp of Object.values(keyProgress)) {
				if (kp.currentTempo > best) best = kp.currentTempo;
			}
		}
		return best;
	});

	const daysSinceLickPractice = $derived.by(() => {
		let mostRecent = 0;
		for (const id of taggedLickIds) {
			const keyProgress = lickPractice.progress[id];
			if (!keyProgress) continue;
			for (const kp of Object.values(keyProgress)) {
				if (kp.lastPracticedAt > mostRecent) mostRecent = kp.lastPracticedAt;
			}
		}
		if (mostRecent === 0) return null;
		return Math.floor((Date.now() - mostRecent) / 86400000);
	});

	const hasLickPracticeHistory = $derived(daysSinceLickPractice !== null);

	function daysAgoLabel(days: number): string {
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		return `${days} days ago`;
	}

	const pct = (n: number) => Math.round(n * 100);
</script>

<SeoHead
	title="Mankunku — Jazz Ear Training in the Browser"
	description="Develop your ear and build your vocabulary. Practice licks and melodic devices across keys, get pitch and rhythm feedback, and put your ideas to work over real tunes."
/>

<!-- Signed-out visitors (and crawlers) get the descriptive landing page; the
     dashboard below assumes a session. Branching on `isAuthenticated` is
     hydration-safe: it derives from server-validated layout data, identical
     during SSR and on the client. -->
{#if !isAuthenticated}
	<HomeLanding />
{:else}
	<StudioPage
		eyebrow="Yakhal’ Inkomo · Cry of the Bull"
		title={`${greeting}${firstName ? ', ' + firstName : ''}`}
		description="The room is yours. What will you play today?"
	>
		<p class="studio-label home-section-label">Pick today's practice</p>
		<div class="home-workspace">
			<div class="home-channels">
				<div data-tour="side-a" class="home-channel" data-domain="ear-training">
					<StudioPanel
						id="home-ear"
						number="A"
						title="Ear Training"
						description="Listen & respond"
						domain="ear-training"
					>
						<div class="studio-well home-readout" data-tour="todays-key">
							<p class="studio-label">
								Today's key / Written pitch <TooltipHint
									text={tooltips.home.todaysKey.text}
									learnMore={tooltips.home.todaysKey.learnMore}
									position="bottom"
								/>
							</p>
							<strong>{todaysTonalityLabel || 'Practice'}</strong>
							<p class="studio-caption">Call & response</p>
						</div>
						<p class="home-channel-copy">
							Call, response, and a little discovery. Match notes by ear, one phrase at a time.
						</p>
						<div class="home-channel-stats">
							{#if hasEarTrainingHistory}
								<p data-tour="level-display">
									Tonal Mastery <strong>{Math.round(mastery.overall)}%</strong>
									· {levelDisp.name}
									<TooltipHint
										text={tooltips.home.mastery.text}
										learnMore={tooltips.home.mastery.learnMore}
										position="bottom"
									/>
								</p>
								{#if lastSession}<p>
										Last: {concertKeyToWritten(lastSession.key, getInstrument())} · {pct(
											lastSession.overall
										)}%
									</p>{/if}
							{:else}<p>No sessions yet</p>{/if}
						</div>
						<a class="studio-action home-start" href="/ear-training"
							><span aria-hidden="true">▶</span>{hasEarTrainingHistory
								? 'Continue'
								: 'Begin first session'}<span aria-hidden="true">↗</span></a
						>
					</StudioPanel>
				</div>
				<div data-tour="side-b" class="home-channel" data-domain="lick-practice">
					<StudioPanel
						id="home-vocabulary"
						number="B"
						title="Lick Practice"
						description="Play over the changes"
						domain="lick-practice"
					>
						<div class="studio-well home-readout">
							<p class="studio-label">
								Your practice set <TooltipHint text={tooltips.home.tagged.text} position="bottom" />
							</p>
							<strong
								>{taggedLickCount > 0
									? `${taggedLickCount} lick${taggedLickCount === 1 ? '' : 's'} ready`
									: 'No licks tagged yet'}</strong
							>
							<p class="studio-caption">Your vocabulary. Your sound.</p>
						</div>
						<p class="home-channel-copy">
							Choose a lick from your book. Then make it yours in all twelve keys.
						</p>
						<div class="home-channel-stats">
							{#if bestLickTempo > 0}<p>
									Best <strong>{bestLickTempo} BPM</strong>
								</p>{/if}
							<p>
								{hasLickPracticeHistory && daysSinceLickPractice !== null
									? `Last: ${daysAgoLabel(daysSinceLickPractice)}`
									: taggedLickCount > 0
										? 'Not practiced yet'
										: 'Your set list is waiting.'}
							</p>
						</div>
						<a
							class="studio-action home-start"
							href={taggedLickCount > 0 ? '/lick-practice' : '/licks'}
							><span aria-hidden="true">{taggedLickCount > 0 ? '▶' : '+'}</span>{taggedLickCount > 0
								? 'Continue'
								: 'Tag a lick to start'}<span aria-hidden="true">↗</span></a
						>
					</StudioPanel>
				</div>
			</div>
			<aside class="studio-panel home-progress" aria-label="Your practice">
				<p class="studio-label">Your practice</p>
				<StudioMeter
					value={progress.sessions.length}
					max={Math.max(20, Math.ceil(progress.sessions.length / 20) * 20)}
					label="Ear training sessions"
				/>
				<h2>Every note counts.</h2>
				<p class="studio-caption">
					{hasEarTrainingHistory
						? 'A little practice, every day.'
						: 'Your first session starts the story.'}
				</p>
				<dl>
					<div>
						<dt>Ear training sessions</dt>
						<dd>{progress.sessions.length}</dd>
					</div>
					<div>
						<dt>Tonal mastery</dt>
						<dd>{Math.round(mastery.overall)}%</dd>
					</div>
					<div data-tour="streak-counter">
						<dt>
							Day streak <TooltipHint text={tooltips.home.streak.text} position="bottom" />
						</dt>
						<dd>{progress.streakDays}</dd>
					</div>
				</dl>
				<a class="studio-text-action" href="/progress">View your progress ↗</a>
			</aside>
		</div>
		<section class="home-library" aria-label="Your library">
			<div>
				<p class="studio-label">Keep exploring</p>
				<h2>Your music,<br />within reach.</h2>
			</div>
			<div class="home-library-links">
				{#each [['Licks', 'Build your vocabulary', '/licks'], ['Tricks', 'Explore melodic devices', '/tricks'], ['Tunes', 'Put it into context', '/tunes'], ['Scales', 'Find your way around', '/scales']] as [title, description, href], i}<a
						{href}
						><span class="studio-label">0{i + 1}</span>
						<div><strong>{title}</strong><small>{description}</small></div>
						<span aria-hidden="true">↗</span></a
					>{/each}
			</div>
		</section>
		<div class="home-bottom">
			<p>
				Make yourself at home.<small
					>Set your instrument, shape your sound, and take it from there.</small
				>
			</p>
			<a href="/settings" class="studio-text-action">Tune your setup ↗</a><a
				href="/docs"
				class="studio-text-action">How it works ↗</a
			>
		</div>
	</StudioPage>
{/if}

<style>
	.home-section-label {
		margin-bottom: 16px;
	}
	.home-workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 240px;
		gap: 24px;
	}
	.home-channels {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 20px;
	}
	.home-channel {
		min-width: 0;
		display: flex;
	}
	.home-channel :global(.studio-panel) {
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	.home-readout {
		min-height: 155px;
	}
	.home-readout strong {
		font: 30px/1.18 var(--font-display);
		color: var(--studio-accent-text);
		display: block;
		margin: 14px 0;
	}
	.home-channel-copy {
		font-size: 12px;
		line-height: 1.8;
		color: var(--studio-muted);
		margin: 20px 0 16px;
	}
	.home-channel-stats {
		font-size: 12px;
		color: var(--studio-muted);
		margin-bottom: 20px;
	}
	.home-channel-stats strong {
		color: var(--studio-text);
	}
	.home-start {
		margin-top: auto;
		justify-content: space-between;
		min-height: 50px;
	}
	.home-progress {
		border-top: 3px solid var(--color-brass);
		padding: 24px 20px;
	}
	.home-progress > .studio-label {
		margin-bottom: 22px;
	}
	.home-progress h2 {
		font: 24px var(--font-display);
		margin-top: 22px;
	}
	.home-progress dl {
		margin: 18px 0;
		font-size: 12px;
	}
	.home-progress dl > div {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		border-bottom: 1px solid var(--studio-border);
		padding: 12px 0;
	}
	.home-progress dt {
		color: var(--studio-muted);
	}
	.home-library {
		display: grid;
		grid-template-columns: 160px minmax(0, 1fr);
		gap: 24px;
		padding: 28px 0;
	}
	.home-library h2 {
		font: 23px/1.2 var(--font-display);
		margin-top: 10px;
	}
	.home-library-links {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}
	.home-library-links a {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 12px;
		border: 1px solid var(--studio-border);
		border-radius: 4px;
		background: var(--studio-panel);
	}
	.home-library-links strong {
		font: 19px var(--font-display);
	}
	.home-library-links small {
		display: block;
		color: var(--studio-muted);
		font-size: 10px;
		margin-top: 4px;
	}
	.home-library-links a > span:last-child {
		margin-left: auto;
	}
	.home-bottom {
		display: flex;
		align-items: center;
		gap: 28px;
		border-top: 1px solid var(--studio-border);
		padding: 24px 0;
	}
	.home-bottom p {
		margin-right: auto;
		font: 20px var(--font-display);
	}
	.home-bottom small {
		font:
			12px/1.7 system-ui,
			sans-serif;
		color: var(--studio-muted);
		display: block;
		margin-top: 6px;
	}
	@media (max-width: 1200px) {
		.home-workspace {
			grid-template-columns: minmax(0, 1fr) 215px;
			gap: 18px;
		}
		.home-channels {
			gap: 16px;
		}
		.home-library {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 1000px) {
		.home-workspace {
			grid-template-columns: 1fr;
		}
		.home-progress {
			display: grid;
			grid-template-columns: 180px minmax(0, 1fr);
			column-gap: 24px;
			align-content: start;
		}
		.home-progress > .studio-label {
			grid-column: 1 / -1;
		}
		.home-progress :global(.studio-meter) {
			grid-column: 1;
			grid-row: 2 / 6;
			align-self: start;
		}
		.home-progress h2 {
			margin-top: 0;
		}
		.home-progress h2,
		.home-progress > .studio-caption,
		.home-progress dl,
		.home-progress > a {
			grid-column: 2;
		}
	}
	@media (max-width: 650px) {
		.home-progress {
			display: block;
		}
		.home-progress :global(.studio-meter) {
			max-width: 240px;
			margin-bottom: 22px;
		}
		.home-channels {
			grid-template-columns: 1fr;
		}
		.home-library-links {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.home-bottom {
			flex-wrap: wrap;
			gap: 16px;
		}
		.home-bottom p {
			width: 100%;
		}
	}
	@media (max-width: 380px) {
		.home-library-links {
			grid-template-columns: 1fr;
		}
		.home-progress :global(.studio-meter) {
			width: 100%;
			margin: 0;
		}
	}
</style>
