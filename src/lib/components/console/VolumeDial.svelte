<script lang="ts">
	import { faderToGain, gainToFader, gainLabel } from '$lib/audio/mixer-policy';
	import Knob from './Knob.svelte';

	interface Props {
		label: string;
		ariaLabel: string;
		gain: number;
		helpText?: string;
		compact?: boolean;
		disabled?: boolean;
		onInput: (gain: number) => void;
		onCommit: () => void;
	}

	let { label, ariaLabel, gain, helpText, compact = false, disabled = false, onInput, onCommit }: Props = $props();
</script>

<Knob
	{label}
	{ariaLabel}
	{helpText}
	{compact}
	{disabled}
	size={compact ? 'md' : 'lg'}
	levelDial
	value={gainToFader(gain)}
	min={0}
	max={1}
	step={0.01}
	displayValue={gainLabel(gain)}
	onInput={(position) => onInput(faderToGain(position))}
	{onCommit}
/>
