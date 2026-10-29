<script lang="ts">
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import { listeningScoreBar, listeningScoreBars } from '$lib/musicality/listening-score';
	import type { ListeningTuneSession } from '$lib/musicality/listening-tunes';

	let { session, barIndex, follow = false }: {
		session: ListeningTuneSession;
		barIndex: number | null;
		/** Clip and follow the active staff instead of showing the complete chart. */
		follow?: boolean;
	} = $props();
	const scoreMap = $derived(listeningScoreBars(session));
	const notationBar = $derived(listeningScoreBar(scoreMap, barIndex));
	const markers = $derived(notationBar === null ? [] : [{
		id: 'listening-playhead', startBar: notationBar, endBarExclusive: notationBar + 1,
		status: 'playhead' as const
	}]);
</script>

<div class="listening-score" data-testid="listening-score" data-key={session.tune.key} data-notation-bar={notationBar ?? ''}
	role="region" aria-label="Tune lead sheet, concert pitch">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (Native arrow-key scrolling needs a focusable, named overflow region.) -->
	<div class="score-scroll" data-testid="listening-score-scroll" tabindex="0"
		role="region" aria-label="Scrollable score. Use arrow keys to move across the music.">
		<div class="score-sheet" data-testid="listening-score-sheet">
			<NotationDisplay tune={session.tune} tuneOptions={{ omitMasthead: true }}
				frameless variant="practice" rangeMarkers={markers} playheadStyle="box"
				autoScrollPlayhead={follow} />
		</div>
	</div>
	<p class="score-scroll-hint">Swipe across the score · Arrow keys when focused</p>
</div>

<style>
	.listening-score {
		--color-bg-secondary: #101c2b;
		--color-text: #edece6;
		--color-text-secondary: #9cabbc;
		--color-brass: #d5ad6c;
		min-width: 0;
		padding: 1.1rem .55rem .3rem;
		background: #101c2b;
		border: 1px solid #52617555;
		border-radius: 3px;
	}
	.score-scroll {
		width: 100%;
		max-width: 100%;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-color: #526175 #101c2b;
		scrollbar-width: thin;
	}
	.score-scroll:focus-visible { outline: 2px solid #d5ad6c; outline-offset: -2px; }
	.score-sheet { min-width: 0; }
	.score-scroll-hint { display: none; }
	@media (max-width: 640px) {
		.listening-score { padding: .8rem .2rem .2rem; }
		.score-sheet { min-width: 650px; }
		.score-scroll-hint {
			display: block;
			padding: .5rem .3rem .25rem;
			color: #9cabbc;
			font-size: .6rem;
			line-height: 1.6;
		}
	}
</style>
