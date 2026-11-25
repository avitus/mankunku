<script lang="ts">
	import NotationDisplay, { type RangeMarker } from '$lib/components/notation/NotationDisplay.svelte';
	import { listeningScoreBar, listeningScoreBars } from '$lib/musicality/listening-score';
	import type { ListeningTuneSession } from '$lib/musicality/listening-tunes';

	let { session, barIndex, follow = false, cues = [] }: {
		session: ListeningTuneSession;
		barIndex: number | null;
		cues?: readonly import('$lib/musicality/listening-cues').ListeningCue[];
		/** Clip and follow the active staff instead of showing the complete chart. */
		follow?: boolean;
	} = $props();
	function scrollWithArrow(event: KeyboardEvent & { currentTarget: EventTarget & HTMLDivElement }) {
		if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
			(event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		event.currentTarget.scrollLeft += event.key === 'ArrowRight' ? 48 : -48;
	}
	const scoreMap = $derived(listeningScoreBars(session));
	const notationBar = $derived(listeningScoreBar(scoreMap, barIndex));
	// The same written bar can occur in multiple passes (or twice within a repeat).
 // Resolve every performed bar separately and give the current occurrence priority.
 const cueMarkers = $derived.by(() => {
  const occurrence = barIndex ?? (cues[0]?.first ?? 1) - 1;
  const pass = session.bars[occurrence]?.context.chorusIndex;
  const byWrittenBar = new Map<number, RangeMarker>();
  for (const cue of cues) {
   for (let number = cue.first; number <= cue.last; number++) {
    const index = number - 1;
    const written = listeningScoreBar(scoreMap, index);
    if (written === null || session.bars[index]?.context.chorusIndex !== pass) continue;
    if (barIndex !== null && scoreMap[barIndex] === written && index !== barIndex) continue;
    byWrittenBar.set(written, {
     id: `listening-cue-${number}`, startBar: written, endBarExclusive: written + 1,
     status: index === barIndex ? 'active' : 'upcoming', color: '#e2bd77', label: cue.note
    });
   }
  }
  return [...byWrittenBar.values()];
 });
 const markers = $derived<RangeMarker[]>(notationBar === null ? cueMarkers : [...cueMarkers, {
  id: 'listening-playhead', startBar: notationBar, endBarExclusive: notationBar + 1, status: 'playhead'
 }]);
</script>

<div class="listening-score" data-testid="listening-score" data-key={session.tune.key} data-notation-bar={notationBar ?? ''}
	role="region" aria-label="Tune lead sheet, concert pitch">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Arrow-key scrolling needs a focusable, named overflow region.) -->
	<div class="score-scroll" data-testid="listening-score-scroll" tabindex="0" onkeydown={scrollWithArrow}
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
