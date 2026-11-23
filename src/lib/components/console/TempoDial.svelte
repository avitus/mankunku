<script lang="ts">
	let {
		value,
		disabled = false,
		label = 'Tempo',
		min = 40,
		max = 240,
		step = 1,
		pageStep = 5,
		onchange,
		oncommit
	}: {
		value: number;
		disabled?: boolean;
		label?: string;
		min?: number;
		max?: number;
		step?: number;
		pageStep?: number;
		oncommit?: () => void;
		onchange: (bpm: number) => void;
	} = $props();
	const hint = $props.id();
	const fraction = $derived((value - min) / (max - min));
	let drag: { id: number; y: number; initial: number } | null = null;
	function update(next: number, commit = false) {
		const bpm = Math.max(min, Math.min(max, min + step * Math.round((next - min) / step)));
		if (value !== bpm) {
			onchange(bpm);
			if (commit) oncommit?.();
		}
	}
	function keydown(event: KeyboardEvent) {
		const increment = step * (event.shiftKey ? 10 : 1);
		const values: Record<string, number> = {
			ArrowUp: value + increment,
			ArrowRight: value + increment,
			ArrowDown: value - increment,
			ArrowLeft: value - increment,
			PageUp: value + pageStep,
			PageDown: value - pageStep,
			Home: min,
			End: max
		};
		if (event.key in values) {
			event.preventDefault();
			update(values[event.key], true);
		}
	}
</script>

<div class="bpm-dial bpm-compact">
	<button class="bpm-control" type="button" role="slider" aria-label={label} aria-orientation="vertical"
		aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} BPM`}
		aria-describedby={hint} {disabled} onkeydown={keydown}
		onpointerdown={event => {
			if (!event.isPrimary || event.button !== 0) return;
			drag = { id: event.pointerId, y: event.clientY, initial: value };
			event.currentTarget.setPointerCapture(event.pointerId);
			event.currentTarget.focus();
		}}
		onpointermove={event => { if (drag?.id === event.pointerId) update(drag.initial + (drag.y - event.clientY) * (max - min) / (event.shiftKey ? 750 : 150)); }}
		onlostpointercapture={() => {
			if (drag) oncommit?.();
			drag = null;
		}}
		onwheel={(event) => {
			if (document.activeElement !== event.currentTarget) return;
			event.preventDefault();
			update(value + (event.deltaY < 0 ? step : -step) * (event.shiftKey ? 10 : 1), true);
		}}>
		<svg class="bpm-scale" viewBox="0 0 100 100" aria-hidden="true">
			{#each Array(17) as _, i}
				<line transform={`rotate(${-135 + i * 270 / 16} 50 50)`} x1="50" x2="50" y1={i % 4 === 0 ? 2.5 : 4} y2="8" class:lit={i / 16 <= fraction} />
			{/each}
		</svg>
		<span class="bpm-knob" aria-hidden="true"><span class="bpm-number">{value}</span></span>
		<svg class="bpm-index" viewBox="0 0 100 100" aria-hidden="true">
			<line transform={`rotate(${-135 + fraction * 270} 50 50)`} x1="50" y1="12.7" x2="50" y2="17.2" />
		</svg>
	</button>
	<span class="bpm-caption" aria-hidden="true">BPM</span>
	<span id={hint} class="bpm-hint">Drag up or down. Use arrow keys to adjust, or Home and End for the limits.</span>
</div>

<style>
.bpm-dial {
  --bpm-size:var(--dial-size, 88px); --bpm-type:34px; --bpm-caption-size:11px;
  --bpm-ink:var(--mk-text,#f5f1e8); --bpm-brass:var(--mk-brass-soft,#e2b875);
  width:var(--bpm-size); display:inline-flex; flex:none; flex-direction:column;
  align-items:center; position:relative; vertical-align:middle; user-select:none;
}
.bpm-dial.bpm-compact { --bpm-size:var(--dial-size, 88px); --bpm-type:25px; --bpm-caption-size:10px; }
.bpm-dial button.bpm-control {
  appearance:none; display:grid; place-items:center; position:relative; flex:none;
  width:var(--bpm-size); height:var(--bpm-size); padding:0; margin:0;
  border:0; border-radius:50%; background:none; box-shadow:none; color:var(--bpm-ink);
  cursor:ns-resize; touch-action:none; -webkit-tap-highlight-color:transparent;
}
.bpm-control .bpm-scale,.bpm-control .bpm-index {
  position:absolute; inset:0; width:100%; height:100%; pointer-events:none;
}
.bpm-scale line {stroke:#6e7a89; stroke-width:1.2; stroke-linecap:round}
.bpm-scale line.lit {stroke:#c6a16a}
.bpm-control .bpm-knob {
  display:grid; place-items:center; width:76%; height:76%; border-radius:50%; box-sizing:border-box;
  border:1px solid #211d16;
  background:conic-gradient(from 20deg,#9a773f,#d4b47a 24%,#7c592f 49%,#b08b51 71%,#e6cc98 88%,#9a773f);
  box-shadow:0 2px 3px #080f1980;
}
.bpm-knob::before {
  content:''; position:absolute; inset:calc(12% + 3px); border-radius:50%; border:1px solid #172333;
  background:radial-gradient(ellipse at 36% 20%,#354555 0%,#263445 54%,#1b2838 100%);
  box-shadow:inset 0 1px 1px #ffffff17;
}
.bpm-knob .bpm-number {
  position:relative; font:500 var(--bpm-type)/1 var(--mk-display,Fraunces,Georgia,serif);
  font-variant-numeric:lining-nums tabular-nums; letter-spacing:-.025em;
}
.bpm-index line {stroke:#fff0ca;stroke-width:2.3;stroke-linecap:round}
.bpm-dial .bpm-caption {
  margin-top:-2px; padding-left:.13em; color:var(--color-brass-soft,var(--bpm-brass));
  font:650 var(--bpm-caption-size)/1.25 'DM Sans',system-ui,sans-serif; letter-spacing:.13em;
}
.bpm-hint {position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden;white-space:nowrap}
.bpm-control:focus-visible {outline:2px solid var(--bpm-brass);outline-offset:2px}
.bpm-dial:has(:disabled) {opacity:.5}
.bpm-dial .bpm-control:disabled {cursor:default}

</style>
