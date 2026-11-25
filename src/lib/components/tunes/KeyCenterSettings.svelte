<script lang="ts">
	let {
		sheet,
		solo,
		onsheet,
		onsolo
	}: {
		sheet: 'chord-stroke' | 'staff-wash';
		solo: 'full-bar' | 'top-strip';
		onsheet: (style: typeof sheet) => void;
		onsolo: (style: typeof solo) => void;
	} = $props();

	const sheets = [
		['chord-stroke', 'Chord stroke'],
		['staff-wash', 'Staff wash']
	] as const;
	const solos = [
		['full-bar', 'Full bar'],
		['top-strip', 'Top strip']
	] as const;
</script>

{#snippet chords(y: number, start: number)}
	<g class="hc-chords" fill="currentColor">
		<text x={start} {y}>Dm<tspan dy="-5" font-size="12">7</tspan></text>
		<text x="111" {y}>G<tspan dy="-5" font-size="12">7</tspan></text>
		<text x="201" {y}>C<tspan dy="-5" font-size="12">maj7</tspan></text>
	</g>
{/snippet}

{#snippet graphic(style: string, staff: boolean)}
	<svg
		aria-hidden="true"
		focusable="false"
		viewBox="0 0 312 104"
		class="hc-sample"
		class:hc-sheet={staff}
		class:hc-live={!staff}
	>
		{#if staff}
			<text class="hc-center" x="40" y="18">C major</text>
			<rect
				x="39"
				y={style === 'chord-stroke' ? 25 : 55}
				width="261"
				height={style === 'chord-stroke' ? 16 : 33}
				rx="1.5"
				fill="var(--hc-sheet-accent)"
				opacity={style === 'chord-stroke' ? 0.22 : 0.15}
			/>
			{@render chords(40, 42)}
			<g fill="none" stroke="currentColor" stroke-width=".85" opacity=".72">
				{#each [59, 65, 71, 77, 83] as y (y)}<path d={`M12 ${y}h288`} />{/each}
				<path d="M190 59v24M300 59v24" />
			</g>
			<g transform="translate(0,-3) scale(.78)">
				<path
					d="M170-1246C170-1243 177-1173 194-1042L219-843L216-833C212-820 190-766 152-673C77-490 30-357 12-272C4-232 0-194 0-159C0-113 7-72 20-34C57 68 131 118 256 118C276 118 293 116 311 112C319 110 325 110 331 110C339 110 341 116 343 126C346 140 347 156 347 171C347 228 323 294 299 336L290 352L290 369C293 419 300 451 318 451C322 451 328 449 334 445C342 439 349 429 355 418C374 378 393 292 393 215C393 175 384 119 378 93L378 92C378 90 379 88 381 86C390 78 421 56 427 52C472 22 521-53 538-105C549-139 558-187 565-249C567-266 569-282 569-297C569-323 567-347 561-369C545-433 508-463 447-463C441-463 434-463 430-462C388-456 349-434 312-400L302-390L300-407C289-483 280-587 273-718L271-752L284-788C320-878 338-955 338-1018C338-1137 295-1221 220-1267C209-1273 204-1276 194-1276C181-1276 170-1258 170-1246M238-1086C241-1086 244-1085 247-1083C260-1077 272-1062 282-1039C284-1036 283-1029 283-1023C283-999 274-957 255-895C254-893 250-878 248-878C246-880 244-900 238-942C234-980 230-1018 230-1058L230-1065C230-1077 230-1086 238-1086M266-370L266-362L243-329C220-296 204-269 194-250C167-199 144-142 140-76C139-60 139-51 138-51C134-51 103-65 101-67C73-83 54-116 54-158C54-164 55-171 56-178C66-252 124-405 227-640C229-644 236-665 238-665C240-663 266-371 266-370M508-302C510-300 509-297 509-291C509-254 486-215 446-164C420-133 398-109 376-94C358-81 348-74 342-74C340-74 339-80 338-90C336-117 326-222 326-250C326-268 327-271 338-281C357-299 419-330 452-330C478-330 501-315 508-302M296-178C300-140 304-111 306-90C308-69 310-58 310-56C310-54 300-54 281-50C254-44 232-42 217-42C211-42 206-41 202-42L189-44L190-54C190-67 193-84 200-102C218-151 243-184 274-222C283-232 288-237 289-237C289-237 292-216 296-178"
					transform="translate(17 110) scale(.034)"
					fill="currentColor"
				/>
			</g>
			{#each [[49, 86], [84, 80], [119, 71], [154, 74], [211, 77], [265, 83]] as [x, y], i (x)}
				<g stroke="currentColor">
					<path d={`M${x + 3.7} ${y - 1}v-19`} fill="none" stroke-width="1.3" />
					<ellipse
						cx={x}
						cy={y}
						rx="4"
						ry="2.7"
						transform={`rotate(-20 ${x} ${y})`}
						fill={i >= 4 ? 'var(--hc-sheet-bg)' : 'currentColor'}
						stroke-width="1.3"
					/>
				</g>
			{/each}
		{:else}
			<rect
				x="12"
				y="13"
				width="288"
				height="78"
				rx="3"
				fill="var(--hc-cell)"
				stroke="var(--hc-rule)"
			/>
			<rect
				x="13"
				y="14"
				width="286"
				height={style === 'full-bar' ? 76 : 8}
				rx="1.5"
				fill="var(--key-center-c)"
				opacity={style === 'full-bar' ? 0.24 : 0.82}
			/>
			<path d="M190 14v76" stroke="var(--hc-rule)" />
			<text class="hc-center" x="23" y="38">C major</text>
			{@render chords(69, 23)}
		{/if}
	</svg>
{/snippet}

<div class="hc-groups">
	<fieldset>
		<legend class="studio-label">Lead sheet</legend>
		<div class="hc-pair">
			{#each sheets as [value, label] (value)}
				<label class="hc-option">
					{@render graphic(value, true)}
					<span class="hc-option-name">
						<input
							type="radio"
							name="sheet-centers"
							{value}
							checked={sheet === value}
							onchange={() => onsheet(value)}
						/>{label}
					</span>
				</label>
			{/each}
		</div>
	</fieldset>
	<fieldset>
		<legend class="studio-label">Live solo</legend>
		<div class="hc-pair">
			{#each solos as [value, label] (value)}
				<label class="hc-option">
					{@render graphic(value, false)}
					<span class="hc-option-name">
						<input
							type="radio"
							name="solo-centers"
							{value}
							checked={solo === value}
							onchange={() => onsolo(value)}
						/>{label}
					</span>
				</label>
			{/each}
		</div>
	</fieldset>
</div>

<style>
	.hc-groups {
		display: grid;
		gap: 24px;
	}
	.hc-groups fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.hc-groups legend {
		padding: 0;
		margin: 0 0 9px;
	}
	.hc-groups .hc-pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.hc-option {
		color: var(--color-text);
		background: var(--studio-well, var(--color-bg));
		display: flex;
		flex-direction: column;
		min-width: 0;
		border: 1px solid var(--color-practice-divider, #536174);
		border-radius: 6px;
		overflow: hidden;
		cursor: pointer;
	}
	.hc-option:has(input:checked) {
		border-color: var(--color-brass, #c8923d);
		box-shadow: inset 0 0 0 1px var(--color-brass, #c8923d);
	}
	.hc-option:has(input:focus-visible) {
		outline: 2px solid var(--color-brass-soft, #e2b875);
		outline-offset: 3px;
	}
	.hc-option-name {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 10px 12px;
		font-size: 0.86rem;
		font-weight: 600;
		line-height: 1.25;
	}
	.hc-option input {
		margin: 0;
		width: 15px;
		height: 15px;
		accent-color: var(--color-brass, #c8923d);
	}
	.hc-sample {
		display: block;
		width: 100%;
		height: auto;
		border-bottom: 1px solid var(--color-practice-divider, #536174);
	}
	.hc-sheet {
		--hc-sheet-bg: var(--studio-well, var(--color-bg, #0f172a));
		--hc-sheet-accent: var(--key-center-c, #83c5f2);
		color: var(--color-text, #f8fafc);
		background: var(--hc-sheet-bg);
	}
	:global(.light) .hc-sheet {
		--hc-sheet-accent: var(--key-center-c, #245e89);
	}
	.hc-live {
		color: var(--color-text);
		background: var(--color-bg);
		--hc-cell: var(--color-bg-secondary);
		--hc-rule: var(--color-practice-divider, #667080);
	}
	.hc-center {
		font:
			600 10px system-ui,
			sans-serif;
		fill: var(--key-center-c, #83c5f2);
	}
	.hc-sheet .hc-center {
		fill: var(--hc-sheet-accent);
	}
	.hc-chords {
		font:
			600 23px Georgia,
			serif;
	}
	@media (max-width: 520px) {
		.hc-groups .hc-pair {
			gap: 8px;
		}
		.hc-option-name {
			font-size: 0.82rem;
			padding: 9px 7px;
			gap: 6px;
		}
		.hc-groups legend {
			margin-bottom: 7px;
		}
	}
	@media (max-width: 440px) {
		.hc-groups .hc-pair {
			grid-template-columns: minmax(0, 1fr);
		}
		.hc-sample {
			max-height: 110px;
		}
	}
</style>
