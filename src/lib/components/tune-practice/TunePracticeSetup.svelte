<script lang="ts">
	import { onMount } from 'svelte';
	import { savedTuneDisplay, saveTuneDisplay } from '$lib/tunes/preferences';
	import NotationDisplay, { type RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import EditorIcon from '$lib/components/step-entry/EditorIcon.svelte';
	import TourTrigger from '$lib/components/ui/TourTrigger.svelte';
	import HelpLink from '$lib/components/ui/HelpLink.svelte';
	import { tunePractice, setTunePracticeBacking, setTunePracticeMelody, setTunePracticeMetronome, setTunePracticeStyle, type SessionPreview } from '$lib/state/tune-practice.svelte';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { BACKING_STYLE_IDS, BACKING_STYLE_NAMES } from '$lib/audio/backing-styles';
	import { TUNE_STYLE_DESCRIPTIONS } from '$lib/tunes/backing-style';
	import { tunePath } from '$lib/tunes/tune-slug';
	import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
	import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
	import type { BackingStyle } from '$lib/types/instruments';
	import type { Tune } from '$lib/types/tune';
	import { tunePracticeTour } from '$lib/tour/tours/tune-practice';
	import '$lib/components/step-entry/lick-editor.css';
	import '$lib/components/tunes/tune-desk.css';
	import '$lib/components/tunes/tune-detail.css';
	import './tune-practice-setup.css';
	import TunePracticeOptions from './TunePracticeOptions.svelte';

	let { tune, previewSheet, preview, markers, writtenKey, isLoading, audioModulesReady, micError, loadError, onstart, ontempo, onkey }: {
		tune: Tune;
		previewSheet: Tune | null;
		preview: SessionPreview | null;
		markers: RangeMarker[];
		writtenKey: PitchClass;
		isLoading: boolean;
		audioModulesReady: boolean;
		micError: boolean;
		loadError: boolean;
		onstart: () => Promise<void>;
		ontempo: (tempo: number) => void;
		onkey: (key: PitchClass) => void;
	} = $props();

	let chartWidth = $state(800);
	let focus = $state(false);
	onMount(() => { focus = savedTuneDisplay('practice-focus', false); });
	/** Persist the practice setup’s focus view, including an Escape exit. */
	function setFocus(enabled: boolean): void { focus = saveTuneDisplay('practice-focus', enabled); }
	const totalBars = $derived((previewSheet ?? tune).sections.reduce((sum, section) => sum + section.bars, 0));
	const tuneHasMelody = $derived(tune.sections.some(section => section.notes.some(note => note.pitch !== null)));
	const startCaption = $derived(!tuneHasMelody
		? 'This chart has no melody — straight to the changes.'
		: tunePractice.config.playHead ? 'Head, solo choruses, then the head again.' : 'Straight to the changes.');
	const progressionCounts = $derived(Object.entries(preview?.byType ?? {}).map(([type, count]) => ({
		type: type as keyof typeof PROGRESSION_TEMPLATES,
		count
	})));
	const modeSummary = $derived(tunePractice.config.mode === 'freestyle' ? 'Freestyle'
		: tunePractice.config.mode === 'points' ? 'Points' : 'Automatic suggestions');
	const cueSummary = $derived(tunePractice.config.strictness === 'guided' ? 'Lick cues'
		: tunePractice.config.strictness === 'solo' ? 'No cues' : 'Progression cues');
	const proposedLicks = $derived([...new Set(
		(preview?.markers ?? []).flatMap(marker => marker.lickName ? [marker.lickName] : [])
	)]);

	/** Keep numeric entry within the same bounds as the former tempo knob. */
	function changeTempo(value: number): void {
		if (Number.isFinite(value)) ontempo(Math.max(50, Math.min(240, Math.round(value))));
	}
	/** Restore numeric entry to the session tempo even when clamping leaves state unchanged. */
	function changeTempoInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		changeTempo(input.valueAsNumber);
		input.value = String(tunePractice.config.tempo);
	}
</script>

<svelte:window onkeydown={event => { if (event.key === 'Escape') setFocus(false); }} />

<div class="lick-editor tune-desk tune-detail studio-desk tune-practice-setup" class:tp-focus={focus}>
	<a class="le-back" href={tunePath(tune)}><EditorIcon name="back" size={14} />{tune.title}</a>
	<header class="td-detail-heading">
		<div><p class="studio-label">Your tune book</p><h1>{tune.title}</h1><p class="td-heading-meta">{tune.composer || 'Your arrangement'} <span>·</span> {totalBars} bars <span>·</span> Practice licks</p></div>
		<div class="tp-help"><TourTrigger tourId="tune-practice" steps={tunePracticeTour} label="How this works" hideIfSeen={false} /><HelpLink href="/docs/tune-practice" label="Tune practice docs" /></div>
	</header>

	<div class="td-detail-layout">
		<div class="td-workspace">
			<section class="le-panel td-detail-chart" aria-label="Practice chart">
				<div class="td-score-top"><div class="td-chart-context"><strong>{tune.sections[0]?.label || '♪'}</strong><h2>Practice licks</h2><span>{totalBars} bars</span></div><button class="td-focus-button" aria-pressed={focus} onclick={() => setFocus(!focus)}>{focus ? 'Exit focus' : '⛶ Focus'}</button></div>
				<div class="tp-insertion-status" role="status">
					<span class="tp-status-dot" aria-hidden="true"></span>
					<div>
						<strong>{tunePractice.config.mode === 'freestyle' ? 'Your solo, your vocabulary' : 'Your licks, in the right places'}</strong>
						{#if tunePractice.config.mode === 'freestyle'}<p>No insertion windows — play freely through the changes.</p>
						{:else if preview && preview.total > 0}
							<p><span>{preview.total} insertion point{preview.total === 1 ? '' : 's'}:</span> {progressionCounts.map(({ type, count }) => `${count}× ${PROGRESSION_TEMPLATES[type].shortName}`).join(', ')}</p>
							{#if preview.matchedCount > 0}
								<p>{preview.matchedCount} with a matching lick from your book.{tunePractice.config.choruses > 1 ? ' The chart names the first visit; later choruses rotate your licks automatically.' : ''}</p>
							{:else}
								<p>{tunePractice.config.mode === 'suggest' ? 'No matching licks from your book are ready in these keys at this tempo. Try a slower tempo or practise the licks in these keys.' : 'No licks in your book match these progressions yet.'}</p>
							{/if}
						{:else}<p>No known progressions detected in this tune yet — you can still play along.</p>{/if}
					</div>
				</div>
				{#if previewSheet}<div class="td-score-well" bind:clientWidth={chartWidth}><NotationDisplay tune={previewSheet} instrument={getInstrument()} staffWidth={chartWidth < 550 ? Math.max(260, chartWidth - 24) : undefined} rangeMarkers={tunePractice.config.mode === 'freestyle' ? [] : markers} tuneOptions={{ omitMasthead: true, barsPerLine: chartWidth < 550 ? 2 : 4 }} frameless /></div>{/if}
				<div class="td-transport td-desk-transport tp-start">
					<button class="le-button le-play" onclick={onstart} disabled={isLoading || !audioModulesReady}><EditorIcon name="play" size={16} />{isLoading ? 'Setting up…' : 'Start'}</button>
					<div class="td-play-summary"><strong>{tunePractice.config.backingTrackEnabled ? `${BACKING_STYLE_NAMES[tunePractice.config.backingStyle]} backing` : 'Backing off'} · {tunePractice.config.tempo} BPM</strong><p>{startCaption}</p></div>
				</div>
				{#if micError}<p class="tp-error" role="alert">Microphone unavailable — check permissions and try again.</p>{/if}
				{#if loadError}<p class="tp-error" role="alert">Audio setup failed — check your connection and try again.</p>{/if}
			</section>
			<TunePracticeOptions hasMelody={tuneHasMelody} disabled={isLoading} />
			<div class="td-reading-footer"><span>{modeSummary}{tunePractice.config.mode !== 'freestyle' ? ` · ${cueSummary}` : ''}</span><em>Familiar phrases. Real tunes.</em></div>
		</div>

		<aside class="tp-rail" aria-label="Practice settings">
			<section class="td-rhythm" aria-label="Rhythm and band">
				<p class="studio-label td-rule-label">Rhythm & band</p>
				<label class="td-tempo-label" for="practice-tempo">Tempo</label>
				<div class="td-tempo-control"><button aria-label="Decrease tempo" disabled={tunePractice.config.tempo <= 50 || isLoading} onclick={() => changeTempo(tunePractice.config.tempo - 5)}>−</button><div><input id="practice-tempo" type="number" min="50" max="240" value={tunePractice.config.tempo} disabled={isLoading} onchange={changeTempoInput} /><span>BPM</span></div><button aria-label="Increase tempo" disabled={tunePractice.config.tempo >= 240 || isLoading} onclick={() => changeTempo(tunePractice.config.tempo + 5)}>+</button></div>
				<button class="td-setting-toggle td-backing-toggle" role="switch" aria-checked={tunePractice.config.backingTrackEnabled} aria-label="Backing track" disabled={isLoading} onclick={() => setTunePracticeBacking(!tunePractice.config.backingTrackEnabled)}><strong>Backing track</strong><span>{tunePractice.config.backingTrackEnabled ? 'On' : 'Off'}<i class="td-switch" class:active={tunePractice.config.backingTrackEnabled} aria-hidden="true"></i></span></button>
				<div class="td-saved-style" class:td-style-muted={!tunePractice.config.backingTrackEnabled}>
					<label class="studio-label" for="practice-style">Practice feel</label>
					<select id="practice-style" aria-label="Backing style" value={tunePractice.config.backingStyle} disabled={!tunePractice.config.backingTrackEnabled || isLoading} onchange={event => setTunePracticeStyle(event.currentTarget.value as BackingStyle)}>{#each BACKING_STYLE_IDS as style}<option value={style}>{BACKING_STYLE_NAMES[style]}</option>{/each}</select>
					<p>{TUNE_STYLE_DESCRIPTIONS[tunePractice.config.backingStyle]}</p><small>Remembered for this tune</small>
				</div>
				<button class="td-setting-toggle" role="switch" aria-checked={tunePractice.config.melodyEnabled} aria-label="Melody" disabled={isLoading} onclick={() => setTunePracticeMelody(!tunePractice.config.melodyEnabled)}><span>Melody</span><span>{tunePractice.config.melodyEnabled ? 'On' : 'Off'}<i class="td-switch" class:active={tunePractice.config.melodyEnabled} aria-hidden="true"></i></span></button>
				<button class="td-setting-toggle" role="switch" aria-checked={tunePractice.config.metronomeEnabled} aria-label="Metronome" disabled={isLoading} onclick={() => setTunePracticeMetronome(!tunePractice.config.metronomeEnabled)}><span>Metronome</span><span>{tunePractice.config.metronomeEnabled ? 'On' : 'Off'}<i class="td-switch" class:active={tunePractice.config.metronomeEnabled} aria-hidden="true"></i></span></button>
				<div class="td-key-row"><label for="practice-key">Key</label><select id="practice-key" value={writtenKey} disabled={isLoading} onchange={event => onkey(event.currentTarget.value as PitchClass)}>{#each PITCH_CLASSES as pc}<option value={pc}>{pc.replace('b', '♭').replace('#', '♯')}</option>{/each}</select></div><p class="td-written-for">Written for {getInstrument().name}.</p>
			</section>
			<section class="td-rail-section tp-guide"><p class="studio-label">Play with your licks</p><h2>{proposedLicks.length > 0 && tunePractice.config.mode !== 'freestyle' ? 'Your proposed licks.' : 'Make the changes yours.'}</h2>{#if tunePractice.config.mode === 'freestyle'}<p>Play freely through the changes. Mankunku listens for the licks you know and celebrates them as you play.</p>
				{:else if proposedLicks.length > 0}
					<ul class="tp-proposed-licks" aria-label="Proposed licks">{#each proposedLicks as name (name)}<li>{name}</li>{/each}</ul>
					<p>Already placed at their matching spots on the chart. Press Start and follow the cues.</p>
				{:else}<p>Mankunku automatically finds licks that fit each progression. Play through the tune and follow the cues on the chart.</p><p>Each insertion is scored. Unmarked bars are yours to improvise.</p>{/if}
				{#if preview && preview.uncategorizedCount > 0}<p class="tp-untagged">{preview.uncategorizedCount} of your licks {preview.uncategorizedCount === 1 ? 'has' : 'have'} no progression tag and can’t be suggested. <a href="/licks">Tag them in My Licks →</a></p>{/if}
			</section>
		</aside>
	</div>
</div>
