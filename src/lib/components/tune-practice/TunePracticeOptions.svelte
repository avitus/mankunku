<script lang="ts">
	import { tunePractice, setTunePracticeChoruses, setTunePracticeOptions } from '$lib/state/tune-practice.svelte';
	import TuneSessionOptions from '$lib/components/tunes/TuneSessionOptions.svelte';

	let { hasMelody, disabled = false }: { hasMelody: boolean; disabled?: boolean } = $props();
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
</script>

<TuneSessionOptions {hasMelody} {disabled} practice choruses={tunePractice.config.choruses}
	playHead={tunePractice.config.playHead} onchoruses={setTunePracticeChoruses}
	onhead={playHead => setTunePracticeOptions({ playHead })} summaryPrefix={modeName}>
		<fieldset class="so-fieldset" role="radiogroup" aria-label="Mode">
			<legend>How do you want to play?</legend>
			<div class="so-choices">{#each modes as mode}<label class="so-choice"><input type="radio" name="tune-practice-mode" aria-label={mode.name} value={mode.id} checked={tunePractice.config.mode === mode.id} onchange={() => setTunePracticeOptions({ mode: mode.id })} /><span class="so-choice-top"><small>{mode.badge}</small><i aria-hidden="true">{tunePractice.config.mode === mode.id ? '✓' : ''}</i></span><strong>{mode.name}</strong><span>{mode.detail}</span></label>{/each}</div>
		</fieldset>
		{#if tunePractice.config.mode !== 'freestyle'}
			<fieldset class="so-fieldset so-cues" role="radiogroup" aria-label="Chart cues">
				<legend>What should the chart tell you?</legend>
				<div class="so-cue-options">{#each cues as cue}<label><input type="radio" name="tune-practice-cues" aria-label={cue.name} value={cue.id} checked={tunePractice.config.strictness === cue.id} onchange={() => setTunePracticeOptions({ strictness: cue.id })} /><span class="so-radio" aria-hidden="true"></span><span><strong>{cue.name}</strong><small>{cue.detail}</small></span></label>{/each}</div>
				<p class="so-note">{tunePractice.config.strictness === 'guided' ? 'A familiar phrase at each matching spot. Just follow the chart.' : tunePractice.config.strictness === 'standard' ? 'Only the progression is named. Any fitting lick from your book counts.' : 'No lick names or progression cues. Any fitting lick from your book counts.'}</p>
			</fieldset>
		{:else}
			<div class="so-free-note"><span aria-hidden="true">♫</span><p><strong>Room to improvise.</strong> No insertion prompts or scores. Mankunku listens for the licks you know.</p></div>
		{/if}
</TuneSessionOptions>
