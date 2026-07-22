<svelte:head>
	<title>Add Lead Sheets — Mankunku</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<div class="smallcaps text-[var(--color-brass)]">Build your book</div>
		<h1 class="font-display text-4xl font-bold tracking-tight">Add Lead Sheets</h1>
		<div class="jazz-rule mt-2 max-w-[140px]"></div>
	</div>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<a
			href="/lead-sheets/entry"
			class="group rounded-lg bg-[var(--color-bg-secondary)] p-6 transition-colors hover:bg-[var(--color-bg-tertiary)]"
		>
			<!-- Brass staff-and-pen glyph -->
			<svg
				class="mb-3 h-8 w-8 text-[var(--color-brass)]"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				aria-hidden="true"
			>
				<path d="M3 6h18 M3 10h18 M3 14h11 M3 18h8" />
				<path d="M16.5 21l5-5-2.5-2.5-5 5V21z" fill="currentColor" stroke="none" />
			</svg>
			<h2 class="font-display text-xl font-semibold group-hover:text-[var(--color-accent)]">
				Manual Entry
			</h2>
			<p class="mt-1 text-sm italic text-[var(--color-text-secondary)]">
				Chart a tune by hand — sections, melody, and changes.
			</p>
		</a>

		<a
			href="/lead-sheets/import/pdf"
			class="group rounded-lg bg-[var(--color-bg-secondary)] p-6 transition-colors hover:bg-[var(--color-bg-tertiary)]"
		>
			<!-- Brass document glyph -->
			<svg
				class="mb-3 h-8 w-8 text-[var(--color-brass)]"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				aria-hidden="true"
			>
				<path d="M6 2h9l5 5v15H6z" />
				<path d="M15 2v5h5" />
				<path d="M9 13h6 M9 17h6" />
			</svg>
			<h2 class="font-display text-xl font-semibold group-hover:text-[var(--color-accent)]">
				PDF Upload
			</h2>
			<p class="mt-1 text-sm italic text-[var(--color-text-secondary)]">
				Let the AI read a scanned chart, then review and correct it.
			</p>
		</a>

		<a
			href="/lead-sheets/import/ireal"
			class="group rounded-lg bg-[var(--color-bg-secondary)] p-6 transition-colors hover:bg-[var(--color-bg-tertiary)]"
		>
			<!-- Brass link glyph -->
			<svg
				class="mb-3 h-8 w-8 text-[var(--color-brass)]"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				aria-hidden="true"
			>
				<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
				<path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
			</svg>
			<h2 class="font-display text-xl font-semibold group-hover:text-[var(--color-accent)]">
				iReal Pro
			</h2>
			<p class="mt-1 text-sm italic text-[var(--color-text-secondary)]">
				Paste an iReal Pro share link — single tunes or whole playlists.
			</p>
		</a>

		<a
			href="/lead-sheets/import/biab"
			class="group rounded-lg bg-[var(--color-bg-secondary)] p-6 transition-colors hover:bg-[var(--color-bg-tertiary)]"
		>
			<!-- Brass box glyph -->
			<svg
				class="mb-3 h-8 w-8 text-[var(--color-brass)]"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				aria-hidden="true"
			>
				<path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
				<path d="M3 7l9 4 9-4 M12 11v10" />
			</svg>
			<h2 class="font-display text-xl font-semibold group-hover:text-[var(--color-accent)]">
				Band-in-a-Box
			</h2>
			<p class="mt-1 text-sm italic text-[var(--color-text-secondary)]">
				Import .SGU/.MGU songs or a BIAB MusicXML export.
			</p>
		</a>
	</div>
</div>
