<script lang="ts">
	import type { CommunityLick } from '$lib/persistence/community';
	import CommunityProgression from './CommunityProgression.svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import { leadSheetTuneFor, leadSheetAbcOptions } from '$lib/music/lead-sheet';
	import { fitLickToRange } from '$lib/phrases/library-loader';
	import { getEffectiveHighestNote, getInstrument, settings } from '$lib/state/settings.svelte';
	import type { Phrase } from '$lib/types/music';

	interface Props {
		lick: CommunityLick;
		isPlaying: boolean;
		favoritePending: boolean;
		bookPending: boolean;
		/** Listen plays the phrase the staff shows — the lick fitted to the player's range. */
		onplay: (phrase: Phrase) => void;
		onfavorite: () => void;
		onbook: () => void;
	}
	let { lick, isPlaying, favoritePending, bookPending, onplay, onfavorite, onbook }: Props = $props();
	// The phrase is stored in its AUTHOR's register. Engrave and audition it in
	// the player's own: a tenor player's line reads an octave under a soprano
	// (2026-10-15). Same-key fit, id kept, the detail page's rule.
	const phrase = $derived(
		fitLickToRange(lick.phrase, getInstrument().concertRangeLow, getEffectiveHighestNote())
	);
	// Keep the whole phrase, including longer imports; only the staff wraps.
	const sheet = $derived(leadSheetTuneFor(phrase, Number.POSITIVE_INFINITY));
	const options = $derived(leadSheetAbcOptions(phrase, 4));
</script>

<section class="listening-desk" aria-label="Selected lick">
	<header class="desk-top">
		<span class="studio-label">On the desk</span>
		<button class="favorite" class:active={lick.isFavoritedByMe} onclick={onfavorite}
			disabled={favoritePending} aria-pressed={lick.isFavoritedByMe}
			aria-label="Favorite {lick.phrase.name}">
			<svg aria-hidden="true" viewBox="0 0 24 24" fill={lick.isFavoritedByMe ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.6"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
			<span>{lick.favoriteCount}</span>
		</button>
	</header>
	<div class="identity">
		<h3>{lick.phrase.name}</h3>
		<p>by {lick.authorName ?? 'anonymous'}</p>
	</div>
	<div class="detail-meta">
		<CommunityProgression phrase={lick.phrase} />
		<span>{settings.defaultTempo} BPM</span>
	</div>
	<!-- Keyboard users must be able to scroll dense notation on narrow screens. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="score-space" role="region" aria-label="Sheet music for {lick.phrase.name}" tabindex="0">
		<div class="score">
			<NotationDisplay tune={sheet.tune} tuneOptions={options} instrument={getInstrument()}
				variant="practice" frameless staffWidth={750} />
		</div>
	</div>
	<footer>
		<button data-domain={isPlaying ? 'lick-practice' : 'neutral'} class="listen" class:playing={isPlaying} onclick={() => onplay(phrase)} aria-label={isPlaying ? 'Stop' : `Listen to ${lick.phrase.name}`}>
			<svg aria-hidden="true" viewBox="0 0 24 24" fill={isPlaying ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.6">
				{#if isPlaying}<rect x="6" y="6" width="12" height="12" rx="1" />{:else}<path d="m8 5 11 7-11 7z" />{/if}
			</svg>
			{isPlaying ? 'Stop' : 'Listen'}
		</button>
		<button class="studio-action" class:added={lick.isStolenByMe} onclick={onbook} disabled={bookPending}
			aria-pressed={lick.isStolenByMe} aria-label={lick.isStolenByMe ? `Remove ${lick.phrase.name} from My Licks` : `Add ${lick.phrase.name} to My Licks`}>
			{lick.isStolenByMe ? '✓ In My Licks' : '+ Add to My Licks'}
		</button>
	</footer>
	<a class="detail-link studio-text-action" href="/licks/{lick.phrase.id}">View lick details ↗</a>
</section>

<style>
	.listening-desk { position: sticky; top: 24px; min-width: 0; padding: 24px; border: 1px solid color-mix(in srgb, var(--studio-border) 65%, transparent); border-radius: 5px; background: color-mix(in srgb, var(--studio-well) 80%, var(--studio-panel)); }
	.desk-top, footer, .detail-meta { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
	.favorite { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 6px; color: var(--studio-muted); font-size: 12px; }
	svg { width: 16px; height: 16px; }
	.favorite.active { color: var(--color-brass-soft); }
	.identity { min-height: 96px; padding-top: 14px; }
	h3 { font: 500 clamp(24px, 2.4vw, 32px)/1.2 var(--font-display); letter-spacing: -.03em; overflow-wrap: anywhere; }
	.identity p { margin-top: 8px; color: var(--studio-muted); font-size: 12px; }
	.detail-meta { justify-content: flex-start; margin: 18px 0; font-size: 11px; color: var(--studio-muted); }
	.score-space { min-height: 240px; display: flex; align-items: center; border-top: 1px solid color-mix(in srgb, var(--studio-border) 45%, transparent); padding: 24px 0; overflow-x: auto; scrollbar-width: thin; }
	.score { min-width: 680px; width: 100%; }
	footer { border-top: 1px solid color-mix(in srgb, var(--studio-border) 45%, transparent); padding-top: 18px; }
	.listen { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 10px 14px; border: 1px solid var(--studio-border); border-radius: 3px; font-size: 12px; }
	.listen.playing { color: var(--studio-accent-text); border-color: currentColor; }
	.added { background: var(--studio-well); color: var(--color-brass-soft); box-shadow: none; border-color: var(--studio-border); }
	.detail-link { display: inline-flex; align-items: center; margin-top: 12px; }
	button:disabled { opacity: .6; cursor: wait; }
	@media (max-width: 600px) { .listening-desk { padding: 18px; } .score-space { min-height: 240px; } footer { gap: 8px; } footer .studio-action { padding: 10px; } }
</style>
