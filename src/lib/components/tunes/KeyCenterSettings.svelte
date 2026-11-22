<script lang="ts">
	let { sheet, solo, onsheet, onsolo }: {
		sheet: 'chord-stroke' | 'staff-wash'; solo: 'full-bar' | 'top-strip';
		onsheet: (style: typeof sheet) => void; onsolo: (style: typeof solo) => void;
	} = $props();

	const sheets = [['chord-stroke', 'Chord stroke'], ['staff-wash', 'Staff wash']] as const;
	const solos = [['full-bar', 'Full bar'], ['top-strip', 'Top strip']] as const;
</script>

<div class="chart-choices">
	{#snippet graphic(style: string, staff: boolean)}
		<svg aria-hidden="true" viewBox="0 0 106 46">
			<rect x="1" y="1" width="104" height="44" rx="3" fill="var(--studio-well, var(--color-bg))" />
			<rect x="5" y={style === 'staff-wash' ? 19 : 5} width="96"
				height={style === 'chord-stroke' ? 13 : style === 'top-strip' ? 5 : 25}
				rx="1" fill="var(--key-center-g)" opacity={style === 'top-strip' ? .6 : .28} />
			{#if staff}
				<path d="M5 21h96 M5 25h96 M5 29h96 M5 33h96 M5 37h96 M52 21v16 M100 21v16" fill="none" stroke="currentColor" stroke-width=".65" opacity=".55" />
				<g fill="currentColor" stroke="currentColor"><ellipse cx="21" cy="31" rx="3" ry="2"/><path d="M24 31V17"/><ellipse cx="69" cy="27" rx="3" ry="2"/><path d="M72 27V14"/></g>
			{:else}
				<path d="M53 6v24 M5 31h96" stroke="currentColor" opacity=".3"/>
				<path d="M11 37h18" stroke="var(--color-brass)" stroke-width="2.5"/>
			{/if}
			<g fill="currentColor" font-family="Georgia, serif" font-size="11">
				<text x="9" y={staff ? 15 : 23}>D−⁷</text><text x="58" y={staff ? 15 : 23}>G⁷</text>
			</g>
		</svg>
	{/snippet}
	<fieldset><legend>Lead sheet key centers</legend><div>
		{#each sheets as [value, label]}
			<label><input type="radio" name="sheet-centers" {value} checked={sheet === value}
				onchange={() => onsheet(value)} />
				{@render graphic(value, true)}<span>{label}</span></label>
		{/each}
	</div></fieldset>
	<fieldset><legend>Real-time solo key centers</legend><div>
		{#each solos as [value, label]}
			<label><input type="radio" name="solo-centers" {value} checked={solo === value}
				onchange={() => onsolo(value)} />
				{@render graphic(value, false)}<span>{label}</span></label>
		{/each}
	</div></fieldset>
</div>

<style>
	.chart-choices { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr)); gap:18px; margin-top:18px; }
	fieldset { min-width:0; border:0; padding:0; }
	legend { color:var(--color-text-secondary); font-size:.8rem; font-weight:600; margin-bottom:6px; }
	fieldset div { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
	label { position:relative; cursor:pointer; border:1px solid var(--color-practice-divider); border-radius:6px; padding:5px 6px; }
	label:has(input:checked) { border-color:var(--color-brass); }
	label:has(input:focus-visible) { outline:2px solid var(--color-brass); outline-offset:2px; }
	input { position:absolute; right:6px; bottom:7px; width:12px; height:12px; accent-color:var(--color-brass); }
	svg { width:100%; max-height:46px; display:block; }
	span { font-size:.75rem; padding-right:15px; }
</style>
