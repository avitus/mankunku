<script lang="ts">
	import { tunePractice, setTunePracticeChoruses } from '$lib/state/tune-practice.svelte';
	import { tooltips } from '$lib/content/tooltips';

	let { hasMelody, disabled = false }: { hasMelody: boolean; disabled?: boolean } = $props();
	const head = $derived(hasMelody && tunePractice.config.playHead);
	const modes = [
		{ id: 'suggest', name: 'Automatic licks', detail: 'Your known licks, placed for you.', badge: 'Suggest' },
		{ id: 'points', name: 'Play for points', detail: 'Pick your lick. Build a streak.', badge: 'Points' },
		{ id: 'freestyle', name: 'Play freely', detail: 'No prompts. Hear what comes out.', badge: 'Freestyle' }
	] as const;
	const cues = [
		{ id: 'guided', name: 'Lick names', detail: 'Know which phrase to play.' },
		{ id: 'standard', name: 'Progressions', detail: 'Choose a lick that fits.' },
		{ id: 'solo', name: 'No cues', detail: 'Find the changes by ear.' }
	] as const;
	const modeName = $derived(modes.find(mode => mode.id === tunePractice.config.mode)?.name);

	function changeChoruses(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		setTunePracticeChoruses(input.valueAsNumber);
		input.value = String(tunePractice.config.choruses);
	}
</script>

<details class="tp-options so-panel">
	<summary class="so-disclosure">
		<span class="so-heading"><span class="so-kicker">Make it your session</span><strong>Session options</strong></span>
		<span class="so-summary">{modeName} · {tunePractice.config.choruses} solo{tunePractice.config.choruses === 1 ? '' : 's'}<span class="so-chevron" aria-hidden="true">⌄</span></span>
	</summary>
	<fieldset {disabled} class="so-body">
		<legend class="sr-only">Session options</legend>
		<div class="so-section-label"><h3>The form</h3><span>One continuous take</span></div>
		<div class="so-form" class:so-solos-only={!head} aria-label="Session form">
			{#if head}<div class="so-head"><span class="so-stage">01 / In</span><strong>Head</strong><small>Play the melody</small></div><span class="so-arrow" aria-hidden="true">→</span>{/if}
			<div class="so-solos">
				<label for="practice-solo-choruses">Solo choruses</label>
				<div class="so-stepper"><button type="button" aria-label="Fewer solo choruses" disabled={tunePractice.config.choruses <= 1} onclick={() => setTunePracticeChoruses(tunePractice.config.choruses - 1)}>−</button><input id="practice-solo-choruses" type="number" min="1" max="12" step="1" value={tunePractice.config.choruses} onchange={changeChoruses} /><button type="button" aria-label="More solo choruses" disabled={tunePractice.config.choruses >= 12} onclick={() => setTunePracticeChoruses(tunePractice.config.choruses + 1)}>+</button></div>
				<small>The changes are yours</small>
			</div>
			{#if head}<span class="so-arrow" aria-hidden="true">→</span><div class="so-head"><span class="so-stage">03 / Out</span><strong>Head again</strong><small>Back to the melody</small></div>{/if}
		</div>
		<div class="so-form-footer"><button type="button" role="switch" aria-label="Play head and outro" aria-checked={head} disabled={!hasMelody} title={hasMelody ? tooltips.tunePractice.head.text : tooltips.tunePractice.headNoMelody.text} class="so-switch-row" onclick={() => tunePractice.config.playHead = !tunePractice.config.playHead}><span class="so-switch" class:on={head} aria-hidden="true"><i></i></span>Head & outro</button><span>Solo count remembered for next time</span></div>
		{#if !hasMelody}<p class="so-note so-no-melody">This chart has no melody — straight to the changes.</p>{/if}
		<fieldset class="so-fieldset" role="radiogroup" aria-label="Mode">
			<legend>How do you want to play?</legend>
			<div class="so-choices">{#each modes as mode}<label class="so-choice"><input type="radio" name="tune-practice-mode" aria-label={mode.name} value={mode.id} checked={tunePractice.config.mode === mode.id} onchange={() => tunePractice.config.mode = mode.id} /><span class="so-choice-top"><small>{mode.badge}</small><i aria-hidden="true">{tunePractice.config.mode === mode.id ? '✓' : ''}</i></span><strong>{mode.name}</strong><span>{mode.detail}</span></label>{/each}</div>
		</fieldset>
		{#if tunePractice.config.mode !== 'freestyle'}
			<fieldset class="so-fieldset so-cues" role="radiogroup" aria-label="Chart cues">
				<legend>What should the chart tell you?</legend>
				<div class="so-cue-options">{#each cues as cue}<label><input type="radio" name="tune-practice-cues" aria-label={cue.name} value={cue.id} checked={tunePractice.config.strictness === cue.id} onchange={() => tunePractice.config.strictness = cue.id} /><span class="so-radio" aria-hidden="true"></span><span><strong>{cue.name}</strong><small>{cue.detail}</small></span></label>{/each}</div>
				<p class="so-note">{tunePractice.config.strictness === 'guided' ? 'A familiar phrase at each matching spot. Just follow the chart.' : tunePractice.config.strictness === 'standard' ? 'Only the progression is named. Any fitting lick from your book counts.' : 'No lick names or progression cues. Any fitting lick from your book counts.'}</p>
			</fieldset>
		{:else}
			<div class="so-free-note"><span aria-hidden="true">♫</span><p><strong>Room to improvise.</strong> No insertion prompts or scores. Mankunku listens for the licks you know.</p></div>
		{/if}
	</fieldset>
</details>

<style>
	.so-panel { margin-top:20px; background:var(--studio-panel); border:1px solid var(--studio-border); border-radius:6px; overflow:hidden; }
	.so-disclosure { cursor:pointer; list-style:none; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:22px 24px; text-align:left; }
	.so-disclosure::-webkit-details-marker { display:none; }
	.so-heading { display:flex; flex-direction:column; gap:7px; }
	.so-kicker { font-size:8px; color:var(--studio-muted); letter-spacing:1.6px; text-transform:uppercase; }
	.so-disclosure strong { font:23px/1.2 var(--font-display); color:var(--studio-text); }
	.so-summary { display:flex; align-items:center; gap:18px; color:var(--studio-muted); font-size:10px; }
	.so-chevron { font:22px Georgia,serif; }
	details[open] .so-chevron { transform:rotate(180deg); }
	.so-body { min-width:0; margin:0; padding:0 24px 23px; border:0; border-top:1px solid var(--studio-border); }
	.so-section-label { display:flex; justify-content:space-between; align-items:center; padding:20px 0 13px; }
	.so-section-label h3, .so-fieldset legend { font-size:12px; font-weight:500; margin:0; color:var(--studio-text); }
	.so-section-label>span { font-size:9px; color:var(--studio-muted); }
	.so-form { display:grid; grid-template-columns:1fr 20px 1.25fr 20px 1fr; align-items:center; border:1px solid var(--studio-border); border-radius:4px; background:var(--studio-well); padding:17px 14px; gap:8px; text-align:center; }
	.so-head { display:flex; flex-direction:column; gap:8px; }
	.so-stage { font:8px monospace; letter-spacing:1.4px; color:var(--studio-muted); text-transform:uppercase; }
	.so-head strong { font:23px var(--font-display); white-space:nowrap; }
	.so-head small, .so-solos>small { font-size:9px; color:var(--studio-muted); }
	.so-arrow { color:var(--studio-muted); }
	.so-solos { border-left:1px solid var(--studio-border); border-right:1px solid var(--studio-border); padding:2px 8px; }
	.so-solos>label { color:var(--color-brass); font-size:8px; letter-spacing:1.5px; display:block; text-transform:uppercase; }
	.so-stepper { display:flex; align-items:center; justify-content:center; gap:15px; margin:9px 0; }
	button { color:inherit; cursor:pointer; background:transparent; font:inherit; }
	.so-stepper button { width:30px; height:30px; border:1px solid var(--studio-border); border-radius:50%; font-size:18px; line-height:1; }
	.so-stepper input { width:42px; min-width:0; padding:0; background:transparent; border:0; text-align:center; color:var(--color-brass); font:32px/1 var(--font-display); appearance:textfield; }
	.so-stepper input::-webkit-inner-spin-button { appearance:none; }
	.so-form-footer { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:13px 0 22px; }
	.so-switch-row { display:flex; align-items:center; gap:9px; font-size:10px; border:0; padding:4px 0; }
	.so-switch { width:27px; height:15px; border:1px solid var(--studio-border); border-radius:20px; padding:3px; display:flex; background:var(--studio-well); }
	.so-switch i { display:block; width:7px; height:7px; border-radius:50%; background:var(--studio-muted); }
	.so-switch.on { border-color:var(--color-brass); background:color-mix(in srgb,var(--color-brass) 25%,transparent); justify-content:flex-end; }
	.so-switch.on i { background:var(--color-brass); }
	.so-form-footer>span { font-size:9px; color:var(--studio-muted); }
	.so-fieldset { padding:0; margin:0 0 22px; border:0; min-width:0; }
	.so-fieldset legend { padding:0 0 13px; }
	.so-choices { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; }
	.so-choice { position:relative; cursor:pointer; border:1px solid var(--studio-border); border-radius:4px; padding:13px; text-align:left; display:flex; flex-direction:column; gap:9px; min-height:116px; background:var(--studio-well); }
	.so-choice:has(input:checked) { border-color:var(--color-brass); background:color-mix(in srgb,var(--color-brass) 8%,var(--studio-well)); }
	input[type=radio] { position:absolute; opacity:0; width:1px; height:1px; }
	.so-choice-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
	.so-choice-top small { font-size:7px; letter-spacing:1.3px; color:var(--studio-muted); text-transform:uppercase; }
	.so-choice:has(input:checked) .so-choice-top small { color:var(--color-brass); }
	.so-choice-top i { width:14px; height:14px; border:1px solid var(--studio-border); border-radius:50%; font-size:9px; font-style:normal; display:grid; place-items:center; }
	.so-choice:has(input:checked) i { background:var(--color-brass); color:var(--studio-well); border-color:var(--color-brass); }
	.so-choice>strong { font-size:12px; font-weight:500; }
	.so-choice>span:last-child { font-size:10px; line-height:1.6; color:var(--studio-muted); }
	.so-cues { margin:0; border-top:1px solid var(--studio-border); padding-top:20px; }
	.so-cues legend { float:left; width:100%; }
	.so-cue-options { clear:both; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
	.so-cue-options label { position:relative; cursor:pointer; display:flex; align-items:flex-start; gap:8px; text-align:left; padding:4px 0; }
	.so-radio { width:12px; height:12px; flex-shrink:0; border:1px solid var(--studio-muted); border-radius:50%; margin-top:1px; }
	input:checked + .so-radio { border-color:var(--color-brass); box-shadow:inset 0 0 0 3px var(--studio-panel); background:var(--color-brass); }
	.so-cue-options strong { font-size:11px; font-weight:500; display:block; color:var(--studio-text); }
	.so-cue-options input:checked ~ span strong { color:var(--color-brass); }
	.so-cue-options small { font-size:9px; display:block; margin-top:6px; color:var(--studio-muted); line-height:1.5; }
	.so-note { font-size:10px; line-height:1.6; margin:16px 0 0; padding:12px 14px; background:var(--studio-well); color:var(--studio-muted); border-left:2px solid var(--studio-border); }
	.so-no-melody { margin:0 0 20px; }
	.so-free-note { display:flex; align-items:center; gap:15px; border-top:1px solid var(--studio-border); padding-top:17px; color:var(--studio-muted); }
	.so-free-note>span { font-size:27px; color:var(--color-brass); }
	.so-free-note p { font-size:11px; line-height:1.7; margin:0; }
	.so-free-note strong { color:var(--studio-text); display:block; font-weight:500; }
	.so-solos-only { display:block; }
	.so-solos-only .so-solos { border:0; }
	button:disabled, .so-body:disabled { opacity:.5; }
	button:disabled, .so-body:disabled label { cursor:default; }
	button:focus-visible, input:focus-visible, summary:focus-visible, label:has(input:focus-visible) { outline:2px solid var(--color-brass); outline-offset:4px; }
	@media(max-width:1050px) {
		.so-disclosure { padding:18px; } .so-summary { font-size:9px; gap:10px; } .so-body { padding:0 18px 20px; }
		.so-form { padding:14px 8px; gap:4px; } .so-head strong { font-size:21px; } .so-stepper { gap:8px; } .so-choice { padding:11px; }
	}
	@media(max-width:600px) {
		.so-panel { margin-top:16px; } .so-summary { max-width:130px; line-height:1.6; } .so-kicker { font-size:7px; } .so-disclosure strong { font-size:22px; }
		.so-body { padding:0 14px 18px; } .so-form { grid-template-columns:1fr 12px 1.2fr 12px 1fr; padding:14px 4px; gap:2px; }
		.so-head strong { font-size:18px; } .so-stage { font-size:7px; letter-spacing:1px; } .so-head small, .so-solos>small { font-size:8px; line-height:1.5; }
		.so-solos { padding:0 5px; } .so-solos>label { font-size:7px; letter-spacing:.6px; } .so-stepper { gap:3px; } .so-stepper button { width:26px; height:26px; } .so-stepper input { font-size:29px; width:31px; }
		.so-form-footer>span { font-size:8px; max-width:125px; text-align:right; line-height:1.5; }
		.so-choices { grid-template-columns:1fr; gap:7px; } .so-choice { min-height:0; display:grid; grid-template-columns:1fr auto; gap:5px; padding:13px 14px; }
		.so-choice-top { grid-column:2; grid-row:1/3; } .so-choice-top small { display:none; } .so-choice>strong { grid-column:1; grid-row:1; } .so-choice>span:last-child { grid-column:1; grid-row:2; }
		.so-cue-options { grid-template-columns:1fr; gap:12px; } .so-cue-options label>span:last-child { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px; } .so-cue-options small { margin:0; }
	}
</style>
