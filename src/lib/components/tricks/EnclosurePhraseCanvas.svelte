<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { ChordProgressionType } from '$lib/types/lick-practice';
	import type { HarmonicSegment, Mode, Phrase } from '$lib/types/music';
	import type { TrickContext, TrickParameters } from '$lib/types/tricks';
	import ChordSymbolText from '$lib/components/music/ChordSymbolText.svelte';
	import { buildEnclosurePreview, ENCLOSURE_TYPES, resolveEnclosureTarget } from '$lib/tricks/devices/enclosures';
	import { ENCLOSURE_PRACTICE_BEDS } from '$lib/tricks/enclosure-practice';
	import { getInstrument } from '$lib/state/settings.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { chordSymbol } from '$lib/music/chords';
	import { displayPitchClass } from '$lib/music/notation';
	import { fractionToFloat } from '$lib/music/intervals';
	import {
		enclosureCanvasLayout,
		enclosureDisplayPitch,
		enclosureParametersWithCount,
		enclosureShapeChoices
	} from '$lib/ui/enclosure-canvas';

	interface Props {
		parameters: TrickParameters;
		onchange: (parameters: TrickParameters) => void;
		/** Concert-pitch context shared with the drill generator and scorer. */
		context: TrickContext;
		progressionType: ChordProgressionType;
		/** Provided by practice setup; omitted on the family-based trick page. */
		onprogressionchange?: (progression: ChordProgressionType) => void;
		status?: string;
		statusKind?: 'ready' | 'locked' | 'exploration';
		/** Audition the selected arrival using the app's existing playback controller. */
		onhear?: (phrase: Phrase) => void | Promise<void>;
		hearing?: boolean;
		/** Stop an audition when the locally inspected arrival chord changes. */
		onpreviewchange?: () => void;
	}

	let {
		parameters,
		onchange,
		context,
		progressionType,
		onprogressionchange,
		status,
		statusKind = 'ready',
		onhear,
		hearing = false,
		onpreviewchange
	}: Props = $props();

	const instanceId = $props.id();
	// Wait for the real container width instead of painting desktop coordinates during SSR.
	let canvasWidth = $state(0);
	let canvasElement: HTMLDivElement;
	let selectedChord = $state(0);
	let openNote = $state<number | null>(null);
	let popover: HTMLDivElement | undefined = $state();
	let noteSelect: HTMLSelectElement | undefined = $state();
	let noteButtons: (HTMLButtonElement | undefined)[] = $state([]);

	const preview = $derived(buildEnclosurePreview(parameters, context, selectedChord));
	const instrument = $derived(getInstrument());
	const displayKey = $derived(concertKeyToWritten(context.key, instrument));
	const displayMode = $derived<Mode>(progressionType === 'minor-vamp' || progressionType === 'ii-V-I-minor-long' ? 'minor' : 'major');
	const selectedIndex = $derived(Math.min(selectedChord, Math.max(0, (preview?.harmony.length ?? 1) - 1)));
	const shapes = $derived(enclosureShapeChoices(parameters.noteCount));
	const isTargetEditor = $derived(openNote !== null && openNote === preview?.targetIndex);
	const selectedBed = $derived(onprogressionchange ? progressionType : (ENCLOSURE_TYPES.find((family) => family.value === parameters.type)?.bed ?? 'major-vamp'));
	const availableBeds = $derived(onprogressionchange ? ENCLOSURE_PRACTICE_BEDS : ENCLOSURE_PRACTICE_BEDS.filter((bed) => bed.harmony.length === 1));

	const displayNotes = $derived.by(() => {
		if (!preview) return [];
		return preview.notes.map((note) => ({
			...note,
			...enclosureDisplayPitch(note.midi, preview.chordContext, displayKey, instrument.transpositionSemitones, displayMode)
		}));
	});
	const layout = $derived(enclosureCanvasLayout(displayNotes, preview?.targetIndex ?? 0, preview?.arrivalOffset ?? [1, 1], canvasWidth));
	const phraseLine = $derived(layout.points.map((point) => `${point.x},${point.y}`).join(' '));
	const targetRole = $derived(preview ? ({ 0: 'root', 3: '♭3', 4: '3rd', 6: '♭5', 7: '5th', 8: '♯5', 9: '♭♭7', 10: '♭7', 11: '7th' } as Record<number, string>)[preview.target.interval] : '');
	const targetChoices = $derived(['root', 'third', 'fifth', 'seventh'].map((value) => ({
		value,
		label: preview ? resolveEnclosureTarget(value, preview.chordContext.chordRoot, preview.chordContext.chordQuality)?.label ?? value : value
	})));
	const arrivalLabel = $derived(parameters.beatPlacement === 'offbeat' ? 'the & of beat 1' : 'beat 1');
	const announcement = $derived(`${displayNotes.map((note) => note.label).join(', then ')}. Target ${preview?.target.label ?? targetRole} on ${arrivalLabel}.${status ? ` ${status}.` : ''}`);
	const activeChordSymbol = $derived(preview ? displayChord({ chord: { root: preview.chordContext.chordRoot, quality: preview.chordContext.chordQuality } }) : '');
	const previousChordSymbol = $derived(preview && preview.harmony.length > 1 && preview.notes.some((note) => fractionToFloat(note.offset) < fractionToFloat(preview.arrivalOffset))
		? displayChord(preview.harmony[(selectedIndex + preview.harmony.length - 1) % preview.harmony.length])
		: null);

	/** Spell the arrival chord in the same written key as its notes. */
	function displayChord(segment: Pick<HarmonicSegment, 'chord'>): string {
		const root = displayPitchClass(concertKeyToWritten(segment.chord.root, instrument), displayKey, displayMode);
		return chordSymbol(root, segment.chord.quality);
	}

	/** Describe the catalog's actual duration alongside each proportional cell. */
	function durationLabel(segment: HarmonicSegment): string {
		const bars = fractionToFloat(segment.duration) / (context.timeSignature[0] / context.timeSignature[1]);
		return `${bars} bar${bars === 1 ? '' : 's'}`;
	}

	/** A bed change keeps gesture axes intact; the parent resolves practice progress. */
	function setProgression(value: string) {
		closeNoteEditor();
		selectedChord = 0;
		if (onprogressionchange) onprogressionchange(value as ChordProgressionType);
		else {
			const family = ENCLOSURE_TYPES.find((entry) => entry.bed === value);
			if (family) onchange({ ...parameters, type: family.value });
		}
	}

	/** Change the count and compatible shape together, preserving role and beat. */
	function setCount(value: string) {
		closeNoteEditor();
		onchange(enclosureParametersWithCount(parameters, value));
	}

	/** Inspect another arrival and stop audio belonging to the previous selection. */
	function selectChord(index: number) {
		closeNoteEditor();
		if (index !== selectedIndex) onpreviewchange?.();
		selectedChord = index;
	}

	/** Move keyboard focus into the native chooser after it enters the DOM. */
	async function showNoteEditor(index: number) {
		openNote = index;
		await tick();
		noteSelect?.focus();
	}

	/** Dismiss the nonmodal chooser, optionally returning to its triggering note. */
	function closeNoteEditor(restoreFocus = false) {
		const index = openNote;
		openNote = null;
		if (restoreFocus && index !== null) noteButtons[index]?.focus({ preventScroll: true });
	}

	/** Apply a complete pattern or target role, then return focus to the graphic. */
	async function chooseNote(value: string) {
		const index = openNote;
		onchange({ ...parameters, [isTargetEditor ? 'targetTone' : 'shape']: value });
		openNote = null;
		await tick();
		if (index !== null) noteButtons[index]?.focus({ preventScroll: true });
	}

	/** Outside clicks dismiss the chooser without stealing focus from another control. */
	function onWindowClick(event: MouseEvent) {
		if (openNote === null || !(event.target instanceof Node)) return;
		if (popover?.contains(event.target) || noteButtons.some((button) => button?.contains(event.target as Node))) return;
		closeNoteEditor();
	}

	/** Escape closes the chooser while retaining the user's place in the phrase. */
	function onWindowKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && openNote !== null) {
			event.preventDefault();
			closeNoteEditor(true);
		}
	}

	$effect(() => {
		void progressionType;
		selectedChord = 0;
		openNote = null;
	});

	onMount(() => {
		let frame = 0;
		let nextWidth = canvasElement.clientWidth;
		canvasWidth = nextWidth;
		// Width determines the compact canvas height. Apply that height change outside
		// ResizeObserver delivery so WebKit does not report a same-frame resize loop.
		const observer = new ResizeObserver(([entry]) => {
			if (entry.contentRect.width === nextWidth) return;
			nextWidth = entry.contentRect.width;
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => { canvasWidth = nextWidth; });
		});
		observer.observe(canvasElement);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	});
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKey} />

<section class="enclosure-editor" aria-label="Enclosure phrase canvas">
	<div class="editor-heading">
		<div class="chord-heading">
			<h2><ChordSymbolText symbol={activeChordSymbol} /></h2>
			{#if status}<span class="editor-status" data-kind={statusKind}>{status}</span>{/if}
		</div>
		{#if onhear}
			<button type="button" class="hear-button" disabled={hearing || !preview} onclick={() => preview && onhear?.(preview.phrase)} aria-label={`Hear enclosure arriving on ${activeChordSymbol}`}>
				<span aria-hidden="true">▶</span> {hearing ? 'Playing…' : 'Hear'}
			</button>
		{/if}
	</div>

	<div class="config-row">
		<label class="progression-field" for={`${instanceId}-progression`}>
			<span class="control-label">{onprogressionchange ? 'Practice over' : 'Chord family'}</span>
			<select id={`${instanceId}-progression`} value={selectedBed} onchange={(event) => setProgression(event.currentTarget.value)}>
				<optgroup label="Single chord">
					{#each availableBeds.filter((bed) => bed.harmony.length === 1) as bed (bed.type)}
						<option value={bed.type}>{bed.name}</option>
					{/each}
				</optgroup>
				{#if onprogressionchange}
					<optgroup label="Progressions">
						{#each availableBeds.filter((bed) => bed.harmony.length > 1) as bed (bed.type)}
							<option value={bed.type}>{bed.name}</option>
						{/each}
					</optgroup>
				{/if}
			</select>
		</label>
		<fieldset class="count-field">
			<legend class="control-label">Approach notes</legend>
			<div class="count-buttons">
				{#each ['1', '2', '3'] as count}
					<button type="button" aria-label={`${count} approach note${count === '1' ? '' : 's'}`} aria-pressed={parameters.noteCount === count} onclick={() => setCount(count)}>{count}</button>
				{/each}
			</div>
		</fieldset>
	</div>

	{#if preview && preview.harmony.length > 1}
		<div class="chord-strip" style:grid-template-columns={preview.harmony.map((segment) => `${fractionToFloat(segment.duration)}fr`).join(' ')} aria-label="Preview an arrival chord">
			{#each preview.harmony as segment, index (index)}
				<button type="button" aria-pressed={selectedIndex === index} aria-label={`Preview arrival on ${displayChord(segment)}, ${durationLabel(segment)}`} onclick={() => selectChord(index)}>
					<span class="strip-chord"><ChordSymbolText symbol={displayChord(segment)} /></span>
					<span class="strip-duration">{durationLabel(segment)}</span>
				</button>
			{/each}
		</div>
		<div class="progression-caption"><span>{displayPitchClass(displayKey, displayKey, displayMode)} {displayMode}</span><span>Enclose each chord change</span></div>
	{/if}

	<div class="canvas-wrap">
		<div class="phrase-canvas" bind:this={canvasElement} style:height={`${layout.height}px`}>
			{#if canvasWidth > 0}
			{#if preview && preview.harmony.length > 1}
				{#if previousChordSymbol}<span class="harmony-caption previous-harmony"><ChordSymbolText symbol={previousChordSymbol} /></span>{/if}
				<span class="harmony-caption arrival-harmony" style:left={`${layout.beatOneX + 8}px`}><ChordSymbolText symbol={activeChordSymbol} /></span>
			{/if}
			<svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
				{#each layout.staffLines as y}<line class="staff-line" x1="8" x2={layout.width - 8} y1={y} y2={y} />{/each}
				<line class="beat-one-marker" data-beat-one-marker x1={layout.beatOneX} x2={layout.beatOneX} y1="10" y2={layout.height - 2} />
				<polyline class="phrase-connection" points={phraseLine} />
			</svg>
			{#each displayNotes as note, index (index)}
				{@const target = index === preview?.targetIndex}
				<button
					type="button"
					class="phrase-note"
					class:target-note={target}
					data-enclosure-note={index}
					data-enclosure-target={target ? '' : undefined}
					bind:this={noteButtons[index]}
					style:left={`${layout.points[index].x}px`}
					style:top={`${layout.points[index].y}px`}
					aria-label={target ? `Target ${note.name}, ${preview?.target.label ?? targetRole}. Choose target chord tone.` : `Approach ${index + 1}: ${note.name}. Choose the complete approach pattern.`}
					aria-expanded={openNote === index}
					aria-controls={`${instanceId}-note-editor`}
					onclick={() => showNoteEditor(index)}
				>
					<span>{note.label}</span>{#if target}<small>{targetRole}</small>{/if}
				</button>
			{/each}
			{/if}
		</div>
		<div class="beat-ruler" aria-label="Target beat placement">
			{#if canvasWidth > 0}
			{#each layout.ticks as beat (beat.column)}
				{#if beat.column === 4 || beat.column === 5}
					{@const value = beat.column === 4 ? 'downbeat' : 'offbeat'}
					<button type="button" style:left={`${beat.x}px`} aria-label={beat.column === 4 ? 'Land on beat 1' : 'Land on the and of beat 1'} aria-pressed={parameters.beatPlacement === value} onclick={() => { closeNoteEditor(); onchange({ ...parameters, beatPlacement: value }); }}>{beat.label}</button>
				{:else}<span style:left={`${beat.x}px`}>{beat.label}</span>{/if}
			{/each}
			{/if}
		</div>
	</div>

	{#if openNote !== null}
		<div class="note-editor" role="dialog" aria-modal="false" aria-labelledby={`${instanceId}-note-title`} id={`${instanceId}-note-editor`} bind:this={popover}>
			<div class="note-editor-heading"><h3 id={`${instanceId}-note-title`}>{isTargetEditor ? 'Choose the destination' : 'Shape the approach'}</h3><button type="button" onclick={() => closeNoteEditor(true)} aria-label="Close note editor">×</button></div>
			<label for={`${instanceId}-note-choice`}>{isTargetEditor ? 'Place in the chord' : 'Complete approach pattern'}</label>
			<select id={`${instanceId}-note-choice`} bind:this={noteSelect} value={isTargetEditor ? parameters.targetTone : parameters.shape} onchange={(event) => chooseNote(event.currentTarget.value)}>
				{#if isTargetEditor}
					{#each targetChoices as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}
				{:else}
					{#each shapes as shape (shape.value)}<option value={shape.value}>{shape.label}</option>{/each}
				{/if}
			</select>
		</div>
	{/if}
	<p class="sr-only" aria-live="polite">{announcement}</p>
</section>

<style>
	.enclosure-editor { position: relative; min-width: 0; border: 1px solid var(--color-bg-tertiary); border-radius: 14px; background: var(--color-bg-secondary); color: var(--color-text); }
	.editor-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 19px 22px 0; }
	.chord-heading { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
	h2 { margin: 0; font-size: 28px; line-height: 1.3; font-weight: 400; }
	.editor-status { display: inline-flex; align-items: center; gap: 6px; color: color-mix(in srgb, var(--color-success) 65%, var(--color-text)); font-size: 11px; }
	.editor-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
	.editor-status[data-kind='locked'], .editor-status[data-kind='exploration'] { color: var(--color-text-secondary); }
	button, select { font: inherit; }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.6; }
	button:focus-visible, select:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }
	.hear-button { border: 1px solid var(--color-bg-tertiary); border-radius: 7px; background: transparent; color: var(--color-text); padding: 9px 12px; display: inline-flex; align-items: center; gap: 7px; font-size: 12px; white-space: nowrap; }
	.config-row { display: flex; align-items: start; justify-content: space-between; gap: 20px; padding: 19px 22px 3px; }
	.progression-field { flex: 1; min-width: 0; max-width: 340px; }
	.control-label { display: block; margin-bottom: 8px; color: var(--color-text-secondary); font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
	select { width: 100%; min-height: 42px; padding: 8px 30px 8px 10px; border: 1px solid var(--color-bg-tertiary); border-radius: 7px; background: var(--color-bg); color: var(--color-text); font-size: 13px; }
	.count-field { border: 0; padding: 0; margin: 0; min-width: 0; }
	.count-buttons { display: flex; gap: 3px; border: 1px solid var(--color-bg-tertiary); border-radius: 8px; padding: 3px; background: var(--color-bg); }
	.count-buttons button { min-width: 34px; min-height: 34px; border: 0; border-radius: 5px; background: transparent; color: var(--color-text-secondary); font-size: 12px; }
	.count-buttons button[aria-pressed='true'] { background: var(--color-bg-secondary); color: var(--color-text); box-shadow: 0 1px 3px color-mix(in srgb, var(--color-text) 8%, transparent); }
	.chord-strip { display: grid; gap: 6px; margin: 15px 22px 0; min-width: 0; }
	.chord-strip button { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 10px 12px; border: 1px solid var(--color-bg-tertiary); border-radius: 7px; background: transparent; color: var(--color-text-secondary); text-align: left; }
	.chord-strip button[aria-pressed='true'] { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-secondary)); color: var(--color-text); }
	.strip-chord { font-size: 22px; }
	.strip-duration { font-size: 11px; white-space: nowrap; }
	.progression-caption { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; padding: 8px 22px 0; color: var(--color-text-secondary); font-size: 11px; }
	.canvas-wrap { padding: 0 12px; }
	.phrase-canvas { position: relative; width: 100%; margin-top: 10px; }
	svg { display: block; position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
	.staff-line { stroke: var(--color-bg-tertiary); stroke-width: 1px; opacity: 0.7; }
	.beat-one-marker { stroke: var(--color-brass); stroke-width: 1.3px; opacity: 0.8; }
	.harmony-caption { position: absolute; top: 2px; color: var(--color-text-secondary); font-size: 15px; pointer-events: none; }
	.previous-harmony { left: 12px; }
	.phrase-connection { fill: none; stroke: var(--color-accent); stroke-width: 2.4px; stroke-linejoin: round; }
	.phrase-note { display: flex; flex-direction: column; align-items: center; justify-content: center; position: absolute; width: 44px; height: 44px; padding: 0; border: 1.5px solid var(--color-accent); border-radius: 50%; background: var(--color-bg-secondary); color: var(--color-text); transform: translate(-50%, -50%); font-family: var(--chord-font); font-size: 21px; line-height: 1.1; }
	.target-note { width: 56px; height: 56px; border-color: var(--color-accent); background: var(--color-accent); color: var(--color-bg); font-size: 24px; box-shadow: 0 0 0 5px color-mix(in srgb, var(--color-accent) 12%, transparent); }
	.target-note small { font-family: system-ui, sans-serif; font-size: 11px; margin-top: 3px; }
	.beat-ruler { position: relative; height: 44px; margin-bottom: 16px; color: var(--color-text-secondary); font-size: 12px; }
	.beat-ruler > * { position: absolute; top: 0; transform: translateX(-50%); width: 44px; height: 44px; display: grid; place-items: center; }
	.beat-ruler button { border: 0; border-radius: 6px; background: transparent; color: var(--color-text-secondary); }
	.beat-ruler button[aria-pressed='true'] { background: color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-secondary)); color: var(--color-text); box-shadow: inset 0 -2px var(--color-accent); }
	.note-editor { position: absolute; z-index: 3; left: 50%; bottom: 60px; transform: translateX(-50%); width: min(330px, calc(100% - 24px)); padding: 15px; border: 1px solid var(--color-bg-tertiary); border-radius: 10px; background: var(--color-bg); box-shadow: 0 8px 30px color-mix(in srgb, var(--color-text) 12%, transparent); }
	.note-editor-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; }
	.note-editor h3 { font-family: Fraunces, Georgia, serif; font-weight: 400; font-size: 20px; margin: 0; }
	.note-editor-heading button { width: 34px; height: 34px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--color-text-secondary); font-size: 24px; }
	.note-editor label { display: block; margin-bottom: 7px; color: var(--color-text-secondary); font-size: 12px; }
	@media (max-width: 600px) {
		.editor-heading { padding: 16px 14px 0; }
		.config-row { padding: 16px 14px 3px; gap: 12px; flex-wrap: wrap; }
		.progression-field { max-width: none; }
		.chord-strip { margin: 13px 14px 0; gap: 5px; }
		.chord-strip button { flex-direction: column; align-items: start; gap: 4px; padding: 9px 7px; }
		.strip-chord { font-size: 20px; }
		.progression-caption { padding: 8px 14px 0; }
		select { font-size: 16px; }
	}
	@media (max-width: 430px) {
		.progression-field { flex-basis: 100%; }
		.editor-heading { gap: 8px; }
		.chord-heading { gap: 6px 10px; }
		h2 { font-size: 27px; }
		.strip-chord { font-size: 18px; }
		.canvas-wrap { padding: 0 8px; }
	}
	@media (pointer: coarse) {
		.hear-button, .count-buttons button, .note-editor-heading button { min-width: 44px; min-height: 44px; }
		select { min-height: 44px; font-size: 16px; }
	}
</style>
