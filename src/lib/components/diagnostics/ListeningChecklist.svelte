<script lang="ts">
	// The listening checklist, rendered from the shared module so the lab
	// UI and the protocol doc can't drift. Verdicts stay in-page state;
	// "Copy report" produces the markdown block pasted into PRs / the
	// listening log in documentation/contributing/backing-listening.md.
	import {
		LISTENING_CHECKLIST,
		CHECKLIST_SECTION_LABELS,
		buildListeningReport,
		type ChecklistVerdict,
		type ChecklistSection
	} from '$lib/audio/backing-listening-checklist';

	let { presetLabel, style, tempo, seed }: {
		presetLabel: string;
		style: string;
		tempo: number;
		seed: number;
	} = $props();

	let verdicts = $state<Partial<Record<string, ChecklistVerdict>>>({});
	let notes = $state('');
	let copied = $state(false);

	const sections = [...new Set(LISTENING_CHECKLIST.map((i) => i.section))] as ChecklistSection[];

	function cycle(id: string): void {
		const order: (ChecklistVerdict | undefined)[] = [undefined, 'pass', 'fail', 'skip'];
		const next = order[(order.indexOf(verdicts[id]) + 1) % order.length];
		verdicts = { ...verdicts, [id]: next };
	}

	function markFor(v: ChecklistVerdict | undefined): string {
		return v === 'pass' ? '✅' : v === 'fail' ? '❌' : v === 'skip' ? '➖' : '⬜';
	}

	async function copyReport(): Promise<void> {
		const report = buildListeningReport({ presetLabel, style, tempo, seed, notes }, verdicts);
		try {
			await navigator.clipboard.writeText(report);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (err) {
			console.warn('clipboard copy failed', err);
		}
	}
</script>

<div class="space-y-4" data-testid="listening-checklist">
	{#each sections as section (section)}
		<div>
			<h3 class="text-sm font-semibold text-[var(--color-text-secondary)] mb-1">
				{CHECKLIST_SECTION_LABELS[section]}
			</h3>
			<ul class="space-y-1">
				{#each LISTENING_CHECKLIST.filter((i) => i.section === section) as item (item.id)}
					<li>
						<button
							onclick={() => cycle(item.id)}
							class="w-full text-left rounded px-2 py-1 hover:bg-[var(--color-bg-tertiary)] transition-colors"
							title={item.detail}
						>
							<span class="mr-2">{markFor(verdicts[item.id])}</span>
							<span class="text-sm">{item.prompt}</span>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/each}

	<label class="block text-sm">
		<span class="block text-[var(--color-text-secondary)] mb-1">Notes</span>
		<textarea
			bind:value={notes}
			rows="3"
			class="w-full rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 text-sm"
			placeholder="What stood out — good or bad"
		></textarea>
	</label>

	<button
		onclick={copyReport}
		class="rounded-full bg-[var(--color-bg-secondary)] px-4 py-1.5 text-sm hover:bg-[var(--color-bg-tertiary)] transition-colors"
	>
		{copied ? 'Copied ✓' : 'Copy listening report'}
	</button>
</div>
