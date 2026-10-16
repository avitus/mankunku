<script lang="ts">
	import type { Snippet } from 'svelte';
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import TuningNotice from '$lib/components/practice/TuningNotice.svelte';
	import type { TuningAlert } from '$lib/scoring/tuning';
	import { GRADE_LABELS } from '$lib/scoring/grades';
	import { GRADE_COLORS, accuracyTier } from '$lib/ui/score-colors';
	import { formatDuration } from '$lib/util/format-duration';
	import type { Score } from '$lib/types/scoring';

	/** Presentation only. The route owns audio, score publication and persistence. */
	interface Props {
		writtenKey: string;
		scaleName: string;
		scaleNoteCount: number;
		elapsedMs: number;
		practising: boolean;
		phase: 'ready' | 'loading' | 'listen' | 'play' | 'next' | 'paused' | 'error';
		disabled: boolean;
		onToggle: () => void;
		score: Score | null;
		quote: string;
		message?: string;
		levelSignal?: { dir: 'up' | 'down'; scaleName: string; level: number } | null;
		/**
		 * The sharp/flat reminder. Shown through Listen and Play as well as on
		 * pause: it is the one piece of tuning feedback meant for live play. The
		 * `tuning` snippet (the fader bank's interpretation) waits for a pause.
		 */
		tuningAlert?: TuningAlert | null;
		help?: Snippet;
		tuning?: Snippet;
	}
	let { writtenKey, scaleName, scaleNoteCount, elapsedMs, practising, phase, disabled,
		onToggle, score, quote, message = '', levelSignal = null, tuningAlert = null, help, tuning }: Props = $props();
	const pct = (n: number): number => Math.round(n * 100);
	const attributionAt = $derived(quote.lastIndexOf(' — '));
	const quoteText = $derived(attributionAt < 0 ? quote : quote.slice(0, attributionAt));
	const quoteAuthor = $derived(attributionAt < 0 ? '' : quote.slice(attributionAt + 3));
	const phaseLabel = $derived({ready: 'Ready', loading: 'Loading', listen: 'Listen', play: 'Play', next: 'Next', paused: 'Paused', error: 'Unavailable'}[phase]);
</script>

<!-- Approved MagicPath revision 460504190599458816. No demo controls or scores. -->
<div class="studio-desk ear-console" class:practising>
	<header class="studio-page-heading">
		<h1>Ear training<span aria-hidden="true">.</span></h1>
		<div class="ear-help" class:concealed={practising}>
			{#if help}{@render help()}{/if}
		</div>
	</header>
	<div class="ear-workspace" data-domain="ear-training">
		<div class="tonality studio-well">
			<div class="today-key"><span class="studio-label">Today's key</span><strong>{writtenKey}</strong></div>
			<div class="scale"><span class="studio-label">Your tonality</span><h2>{scaleName}</h2><p>{scaleNoteCount} notes</p></div>
			<div class="session-time" class:concealed={elapsedMs <= 0}>
				<span class="studio-label">Session time</span>
				{#if elapsedMs > 0}<span role="timer" aria-label="Time practised this session">{formatDuration(elapsedMs / 1000)}</span>{/if}
			</div>
		</div>
		<StudioPanel id="ear-response" number="01" title="Call & response" domain="ear-training">
			<div class="phase" data-phase={phase} data-tour="status-text" role="status" aria-atomic="true"><i aria-hidden="true"></i>{phaseLabel}</div>
			<div class="transport-row">
				<div class="transport">
					<button type="button" data-tour="play-button" class="play-button" class:active={practising}
						disabled={disabled} onclick={onToggle} aria-label={practising ? 'Pause practice' : 'Start practice'}>
						<svg viewBox="0 0 32 32" aria-hidden="true">
							{#if practising}<rect x="8" y="7" width="5" height="18" rx="1"/><rect x="19" y="7" width="5" height="18" rx="1"/>
							{:else}<path d="M11 7v18l15-9z"/>{/if}
						</svg>
					</button>
					<span class="studio-label">{phase === 'loading' ? 'Loading' : practising ? 'Pause' : 'Start practice'}</span>
				</div>
				<div class="score studio-well" data-tour="score-display">
					<span class="studio-label">{score ? 'Last take' : 'Your score'}</span>
					{#if score}<span class="sr-only">{GRADE_LABELS[score.grade]}</span>{/if}
					<div class="score-values">
						<div class="overall" style:color={score ? GRADE_COLORS[score.grade] : 'var(--studio-text)'}>
							<strong>{score ? pct(score.overall) : '—'}{#if score}<small>%</small>{/if}</strong><span>Overall</span>
						</div>
						<div style:color={score ? accuracyTier(score.pitchAccuracy) : 'var(--studio-text)'}>
							<strong>{score ? pct(score.pitchAccuracy) : '—'}{#if score}<small>%</small>{/if}</strong><span>Pitch</span>
						</div>
						<div style:color={score ? accuracyTier(score.rhythmAccuracy) : 'var(--studio-text)'}>
							<strong>{score ? pct(score.rhythmAccuracy) : '—'}{#if score}<small>%</small>{/if}</strong><span>Rhythm</span>
						</div>
					</div>
					<p class="empty-score" class:concealed={!!score}>Score after your first take.</p>
				</div>
			</div>
			<div class="feedback" role="status" aria-atomic="true">
				{#if message}<p>{message}</p>{/if}
				{#if levelSignal}<span class="level-signal" class:is-up={levelSignal.dir === 'up'}>{levelSignal.dir === 'up' ? '↑' : '↓'} {levelSignal.scaleName} · Lv {levelSignal.level}</span>{/if}
			</div>
			<!-- The one-line sharp/flat reminder stays up while playing (2026-10-15: a
			     run centred 14 ¢ sharp earned it on 18 of 52 takes and the player saw
			     none, because it sat in the paused-only region below). Its line is
			     reserved when clear, so Listen and Play keep one layout. -->
			<TuningNotice alert={tuningAlert} />
		</StudioPanel>
		<!-- Fixed region: even the longest existing caption cannot move the controls.
		     Quotes and the fader bank are only rendered while paused, never changed
		     under a playing user. -->
		<div class="quote-slot" data-testid="practice-quote">
			{#if !practising && quote}
				<figure><blockquote>{quoteText}</blockquote>{#if quoteAuthor}<figcaption>— {quoteAuthor}</figcaption>{/if}</figure>
			{/if}
		</div>
		{#if !practising && tuning}{@render tuning()}{/if}
	</div>
</div>

<style>
	.ear-console { max-width: 1280px; margin: auto; }
	.studio-page-heading h1 { margin: 0; }
	.studio-page-heading h1 span { color: var(--color-accent); }
	.ear-help { display: flex; align-items: center; gap: 18px; }
	.ear-workspace { max-width: 1000px; margin: auto; display: grid; gap: 20px; }
	.concealed { visibility: hidden; }
	.tonality { display: flex; align-items: center; gap: 28px; padding: 20px 26px; }
	.studio-label { color: var(--studio-muted); font-size: 10px; }
	.today-key { min-width: 104px; border-right: 1px solid var(--studio-border); }
	.today-key strong { display: block; font: 500 46px/1.1 var(--font-display); color: var(--studio-accent-text); margin-top: 5px; }
	.scale { min-width: 0; }
	.scale h2 { font: 500 24px/1.3 var(--font-display); margin: 5px 0; overflow-wrap: anywhere; }
	.scale p { font-size: 12px; color: var(--studio-muted); }
	.session-time { margin-left: auto; text-align: right; min-width: 100px; }
	.session-time [role='timer'] { display: block; font: 24px/1.2 var(--font-display); font-variant-numeric: tabular-nums; margin-top: 6px; }
	.phase { position: absolute; right: 30px; top: 30px; display: flex; align-items: center; gap: 8px; min-width: 76px; color: var(--studio-muted); font-size: 12px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
	.phase i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
	.phase[data-phase='listen'] { color: color-mix(in srgb, var(--color-phase-listen) 55%, var(--studio-text)); }
	.phase[data-phase='play'] { color: color-mix(in srgb, var(--color-phase-play) 55%, var(--studio-text)); }
	.transport-row { display: grid; grid-template-columns: 200px 1fr; align-items: center; gap: 40px; max-width: 770px; margin: 24px auto 14px; }
	.transport { display: flex; align-items: center; flex-direction: column; gap: 17px; }
	.play-button { height: 104px; width: 104px; padding: 27px; border: 1px solid var(--color-brass-soft); border-radius: 50%; background: radial-gradient(ellipse at 35% 20%, #438d9a, #236776 80%); box-shadow: 0 0 0 5px var(--studio-well), 0 0 0 6px var(--color-brass), 0 7px 14px #0005, inset 0 1px 1px #ffffff40; color: white; cursor: pointer; }
	.play-button svg { width: 100%; height: 100%; fill: currentColor; }
	.play-button:hover:not(:disabled) { filter: brightness(1.12); }
	.play-button.active { background: linear-gradient(#ffffff15, transparent), var(--color-onair); }
	.play-button:disabled { opacity: .5; cursor: not-allowed; }
	.score { min-width: 0; padding: 18px 24px 15px; }
	.score-values { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 22px; align-items: center; margin: 8px 0 3px; }
	.score-values strong { display: block; font: 500 28px/1.15 var(--font-display); font-variant-numeric: tabular-nums; }
	.score-values .overall strong { font-size: 46px; }
	.score-values small { font: 13px Arial, Helvetica, sans-serif; color: var(--studio-muted); margin-left: 3px; }
	.score-values span { display: block; font-size: 12px; color: var(--studio-muted); margin-top: 5px; }
	.empty-score { min-height: 25px; padding-top: 10px; font-size: 11px; color: var(--studio-muted); }
	.feedback { min-height: 32px; color: var(--studio-muted); text-align: center; font-size: 12px; }
	.level-signal { display: block; font-size: 11px; }
	.level-signal.is-up { color: var(--color-brass); }
	.quote-slot { height: 136px; display: grid; place-items: center; overflow: auto; }
	.quote-slot figure { max-width: 620px; margin: auto; padding: 12px 18px; text-align: center; }
	.quote-slot blockquote { font: italic 17px/1.5 var(--font-display); color: var(--studio-muted); }
	.quote-slot figcaption { color: var(--studio-muted); font-size: 12px; margin-top: 8px; }
	@media (max-width: 900px) {
		.transport-row { grid-template-columns: 145px 1fr; gap: 20px; }
		.phase { right: 24px; }
	}
	@media (max-width: 600px) {
		.studio-page-heading { flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
		.tonality { gap: 18px; padding: 17px; flex-wrap: wrap; }
		.today-key { min-width: 62px; }
		.today-key strong { font-size: 38px; }
		.scale { flex: 1; }
		.scale h2 { font-size: 20px; }
		.session-time { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; border-top: 1px solid var(--studio-border); padding-top: 10px; }
		.session-time [role='timer'] { font: 14px Arial, Helvetica, sans-serif; margin: 0; }
		.phase { right: 18px; font-size: 10px; min-width: 54px; top: 32px; }
		.transport-row { grid-template-columns: 1fr; gap: 23px; margin: 28px auto 18px; }
		.play-button { width: 88px; height: 88px; padding: 23px; }
		.score { width: 100%; padding: 15px 18px; }
		.score-values { gap: 16px; }
		.score-values .overall strong { font-size: 40px; }
		.score-values strong { font-size: 25px; }
		.quote-slot { height: 192px; }
		.quote-slot figure { padding: 12px 8px; }
		.quote-slot blockquote { font-size: 16px; }
	}
</style>
