<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { Phrase } from '$lib/types/music';
	import type { Tune } from '$lib/types/tune';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { phraseToAbcWithMap, type NoteAnchor } from '$lib/music/notation';
	import {
		tuneToAbcWithMap,
		CHART_STAFF_WIDTH,
		type BarAnchor,
		type ChordSlotAnchor,
		type TuneAbcOptions
	} from '$lib/music/tune-notation';
	import { alignStackedEndingsInContainer } from '$lib/notation/ending-align-dom';
	import { barZones, chordZones, clipBarSpanX, type ChordZone } from '$lib/notation/chart-geometry';
	import {
		buildFollowSystems,
		followOffsetPx as computeFollowOffset,
		svgCssScale
	} from '$lib/notation/follow-scroll';
	import {
		systemsFromVisualObj,
		toSystemLayouts,
		findVoiceItem,
		overlayBoxPct,
		formShape,
		resolveChartClick,
		chordKeyAction,
		bandGeometry,
		barHitRect,
		chordHitRect,
		chordSymbolDeltas,
		chordHorizontalNudges,
		partLabelDelta,
		glissandoWave,
		type AdapterVisualObj,
		type BandGeometry,
		type OverlayBox,
		type RectSpec
	} from '$lib/notation/abcjs-adapter';
	import {
		chordDisplayModelFromText,
		chordTspanSpecs,
		alterationStackX
	} from '$lib/music/chord-layout';

	type BeatPos = { sectionIdx: number; bar: number; beat: number };

	/** Tinted bar-range band on a tune chart, in absolute notation bars. */
	export interface RangeMarker {
		id: string;
		startBar: number;
		endBarExclusive: number;
		/**
		 * Optional half-open span in whole-note units (form-absolute). When set,
		 * each bar's band is clipped to the portion of the bar the span covers —
		 * so two mid-bar-abutted insertions split the shared bar instead of
		 * stacking two full-bar washes.
		 */
		timeRange?: { start: number; end: number };
		/** 'playhead' is the moving current-bar band (never labeled). */
		status: 'upcoming' | 'active' | 'hit' | 'missed' | 'playhead';
		/** Text drawn inside the band below the staff (e.g. the lick's name). */
		label?: string;
		/**
		 * Progression identity colour (a CSS colour, e.g. a `var(--prog-*)` ref).
		 * When set it tints the band + label to the matched progression's hue for
		 * `upcoming`/`active` states; `hit`/`missed` keep their semantic outcome
		 * colours (green/red), and the playhead is never coloured this way.
		 */
		color?: string;
	}

	/** Visual treatment for the current-bar playhead marker. */
	export type PlayheadStyle = 'under-bar' | 'cursor-line' | 'box' | 'wash-strong' | 'underline-caret';

	/**
	 * Chart presentation:
	 * - `practice` — dark interactive chart (editor / session teleprompter)
	 * - `print` — light Real Book–style engraving (detail / read-only stand view)
	 */
	export type ChartVariant = 'practice' | 'print';

	interface Props {
		phrase?: Phrase | null;
		/**
		 * Full song form rendered with chord symbols, section markers, and
		 * multi-system reflow. Takes precedence over `phrase` when set;
		 * click/highlight indices refer to the flattened note order
		 * (`flattenTune(sheet).notes`).
		 */
		tune?: Tune | null;
		instrument?: InstrumentConfig;
		/**
		 * Visual house style. Print uses a light ink chart with the engraved
		 * masthead; practice keeps the dark interactive chrome.
		 */
		variant?: ChartVariant;
		/** Source-array index of the note to highlight, or `null` for no highlight. */
		selectedIndex?: number | null;
		/**
		 * Playback cursor (notation-order note index), styled distinctly from
		 * `selectedIndex`. Unlike `selectedIndex`, changing it never re-renders
		 * the chart — a dedicated effect swaps a CSS class on the stashed
		 * anchors, so it is safe to drive per-note during playback.
		 */
		cursorIndex?: number | null;
		/**
		 * Insertion-point range bands (tune charts only). Status changes swap
		 * a handful of overlay rects without re-rendering the chart.
		 */
		rangeMarkers?: RangeMarker[];
		/** Visual treatment for `status: 'playhead'` markers. Default 'under-bar'. */
		playheadStyle?: PlayheadStyle;
		/**
		 * Auto-scroll the chart within a clipped viewport as the playhead
		 * advances. Off by default so multi-chart pages don't fight over the
		 * window scroll. Prefer pairing with `playheadBarFraction` for
		 * continuous (lick-practice-style) drift; without it, falls back to
		 * the integer playhead marker's system top.
		 */
		autoScrollPlayhead?: boolean;
		/**
		 * Fractional absolute notation bar for continuous follow-scroll
		 * (e.g. 3.42 = 42% through bar 3). Updated each animation frame from
		 * transport ticks. When null/undefined, scroll keys off the discrete
		 * playhead range marker instead.
		 */
		playheadBarFraction?: number | null;
		/** Fires when the user clicks a note or an anchored rest. Receives the source-array index. */
		onSelect?: (sourceIndex: number) => void;
		/**
		 * Fires when the user clicks a bar's empty space, an UNANCHORED rest
		 * (slash bar or pure melody gap), or a chord symbol on a tune chart.
		 * Enables the invisible per-bar hit rects.
		 */
		onBarClick?: (pos: { sectionIdx: number; bar: number }) => void;
		/**
		 * Inline on-chart chord editing. Enables per-beat hit rects above the
		 * staff; clicking one opens a positioned input prefilled via `textAt`.
		 * `commit` returns false for unparseable text (input flashes and stays
		 * open); blank input calls `clear`.
		 */
		chordEditor?: {
			textAt: (pos: BeatPos) => string | null;
			commit: (pos: BeatPos, text: string) => boolean;
			clear: (pos: BeatPos) => void;
		};
		titleArea?: Snippet;
		/**
		 * Engraving options for the `tune` path (mode, bars per system, stretch,
		 * measure numbers). A lead-sheet row passes its phrase's mode and a
		 * single full-width system; every other chart takes the defaults.
		 */
		tuneOptions?: TuneAbcOptions;
		/**
		 * No chrome: drops the "Chart" liner, padding and panel background so
		 * the staff sits inside a host that owns its own frame (the lick-practice
		 * key stack). Ink styling of the variant is unchanged.
		 */
		frameless?: boolean;
		/**
		 * abcjs staff width in SVG units (default `CHART_STAFF_WIDTH`). A host
		 * that sizes the SVG by HEIGHT (a fixed-height row) asks for a wider
		 * staff so the single system spans the row.
		 */
		staffWidth?: number;
	}

	let {
		phrase = null,
		tune = null,
		instrument,
		variant = 'practice',
		selectedIndex = null,
		cursorIndex = null,
		rangeMarkers,
		playheadStyle = 'under-bar',
		autoScrollPlayhead = false,
		playheadBarFraction = null,
		onSelect,
		onBarClick,
		chordEditor,
		titleArea,
		tuneOptions,
		frameless = false,
		staffWidth
	}: Props = $props();

	/** Print charts show abcjs's own title/composer/style masthead. */
	const showEngravedMasthead = $derived(variant === 'print' && !!tune && !titleArea);

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	/** Clipped viewport that the chart translates within when following playback. */
	let viewportEl = $state<HTMLDivElement | undefined>(undefined);
	/** Playback-follow vertical offset (px) applied to the chart; 0 = top. */
	let followOffsetPx = $state(0);
	let abcjs = $state<typeof import('abcjs') | null>(null);

	// ── Inline chord editor state ────────────────────────────────────────────
	let chordEdit: BeatPos | null = $state(null);
	let chordInputValue = $state('');
	let chordInputEl: HTMLInputElement | undefined = $state();
	let errorFlash = $state(false);
	let errorTimer: ReturnType<typeof setTimeout> | null = null;
	let overlayBox: OverlayBox | null = $state(null);
	/** Bumped after every abcjs render so the input re-positions/re-focuses. */
	let renderVersion = $state(0);

	/** Per-system vertical geometry, measured before any hit rects go in. */
	interface SystemBand extends BandGeometry {
		wrapper: SVGGElement;
	}

	// Non-reactive per-render caches consumed by the positioning effect.
	let lastChordZones: ChordZone[] = [];
	let systemBands: SystemBand[] = [];
	let lastViewBox: { width: number; height: number } | null = null;
	// Non-reactive per-render caches for the cursor + range-marker effects —
	// they let those effects address the rendered SVG without re-running
	// renderAbc (the render effect must never read cursorIndex/rangeMarkers).
	let lastVisualObj: AdapterVisualObj | null = null;
	let lastNoteAnchors: NoteAnchor[] = [];
	let lastBarZones: ReturnType<typeof barZones> = [];
	let prevCursorEl: SVGGraphicsElement | null = null;

	/** Absolute-notation-bar start of each section (for marker/scroll mapping). */
	function sectionBarBases(sheet: Tune): number[] {
		const bases: number[] = [];
		let acc = 0;
		for (const sec of sheet.sections) {
			bases.push(acc);
			acc += sec.bars;
		}
		return bases;
	}

	onMount(async () => {
		abcjs = await import('abcjs');
	});

	$effect(() => () => {
		if (errorTimer) clearTimeout(errorTimer);
	});

	$effect(() => {
		if (!abcjs || !containerEl || (!phrase && !tune)) return;

		// Drop any stale follow-scroll translate before replacing the SVG.
		// Head→changes sheet swaps re-render a (often shorter) chart into the
		// same container; keeping the previous translateY would park the new
		// SVG entirely above the clipped viewport ("score disappeared").
		if (autoScrollPlayhead) followOffsetPx = 0;

		const rendered: {
			abc: string;
			noteAnchors: NoteAnchor[];
			barAnchors: BarAnchor[];
			chordSlotAnchors: ChordSlotAnchor[];
		} = tune
			? tuneToAbcWithMap(tune, instrument, tuneOptions)
			: {
					...phraseToAbcWithMap(phrase!, instrument),
					barAnchors: [],
					chordSlotAnchors: []
				};
		const { abc, noteAnchors, barAnchors, chordSlotAnchors } = rendered;
		// Engraving house style: wider staff, the app chord face, Real Book
		// masthead fonts. jazzchords is intentionally OFF — its superscript
		// markers mis-parse ASCII flats ("Bb7" → B + b7); structureChordSymbols
		// does the superscript engraving after render. gchordfont only feeds
		// abcjs's width estimation; the painted face is the --chord-font CSS.
		const [visualObj] = abcjs.renderAbc(containerEl, abc, {
			responsive: 'resize',
			staffwidth: staffWidth ?? CHART_STAFF_WIDTH,
			paddingtop: showEngravedMasthead ? 8 : 12,
			paddingbottom: 16,
			paddingleft: 12,
			paddingright: 12,
			add_classes: true,
			format: {
				gchordfont: { face: 'Fraunces, Edwin, Georgia, serif', size: 15, weight: 'normal', style: 'normal', decoration: 'none' },
				// Bold boxed rehearsal letters (%%partsbox 1 draws the square).
				partsfont: {
					face: 'Fraunces, Georgia, "Times New Roman", serif',
					size: 14,
					weight: 'bold',
					style: 'normal',
					decoration: 'none'
				},
				titlefont: {
					face: 'Fraunces, Georgia, "Times New Roman", serif',
					size: 22,
					weight: 'normal',
					style: 'normal',
					decoration: 'none'
				},
				composerfont: {
					face: 'Fraunces, Georgia, "Times New Roman", serif',
					size: 13,
					weight: 'normal',
					style: 'italic',
					decoration: 'none'
				},
				infofont: { face: 'MuseJazzText', size: 12, weight: 'normal', style: 'normal', decoration: 'none' },
				// Quiet navigation marks — slightly smaller than body text.
				measurefont: {
					face: 'Fraunces, Georgia, "Times New Roman", serif',
					size: 8,
					weight: 'normal',
					style: 'italic',
					decoration: 'none'
				},
				subtitlefont: {
					face: 'Fraunces, Georgia, "Times New Roman", serif',
					size: 14,
					weight: 'normal',
					style: 'normal',
					decoration: 'none'
				}
			},
			clickListener: (abcElem, _tuneNumber, _classes, analysis) => {
				if (!abcElem) return;
				const startChar = (abcElem as { startChar?: number }).startChar;
				if (typeof startChar !== 'number') return;
				const target = resolveChartClick(startChar, noteAnchors, chordSlotAnchors, barAnchors);
				if (target?.kind === 'note') {
					onSelect?.(target.sourceIndex);
					return;
				}
				if (target?.kind !== 'bar') return;
				// Clicking a rendered chord SYMBOL means "edit this chord"
				// (MuseScore behavior), not "move the cursor". The clicked-glyph
				// name distinguishes the chord text from the other glyphs (rests)
				// sharing the chord voice's charspans.
				if (chordEditor && analysis?.clickedName === 'chord') {
					const slot = chordSlotAnchors.find(
						(a) => startChar >= a.startChar && startChar < a.endChar
					);
					if (slot) {
						openChordEditorAt({ sectionIdx: slot.sectionIdx, bar: slot.bar, beat: slot.beat });
						return;
					}
				}
				onBarClick?.(target.pos);
			}
		});
		const vo = visualObj as unknown as AdapterVisualObj;

		// H is spacer-only now (no visible rests) — no rest-shift needed.
		// Order: stack chords → drop/nudge → seat rehearsal marks → align
		// stacked [2] under [1] (no pad bars in the ABC).
		structureChordSymbols(containerEl);
		dropChordSymbols(containerEl);
		nudgeChordSymbols(containerEl);
		repositionPartLabels(containerEl);
		// Stacked second endings: map [2] onto [1]'s horizontal span (pure-translate
		// glyphs, scale only volta/beam line art) — driven entirely from the rendered
		// DOM geometry, no ABC-side hints.
		alignStackedEndingsInContainer(containerEl);
		drawGlissandi(vo, noteAnchors);
		applySelectionHighlight(vo, noteAnchors, selectedIndex);
		buildHitZones(containerEl, vo, rendered);
		// Stash for the cursor/marker effects. The cursor element belonged to
		// the SVG this render just replaced, so forget it.
		lastVisualObj = vo;
		lastNoteAnchors = noteAnchors;
		prevCursorEl = null;
		untrack(() => (renderVersion += 1));
	});

	// Playback cursor — a class swap on the stashed render, never a re-render.
	$effect(() => {
		const idx = cursorIndex;
		void renderVersion;
		prevCursorEl?.classList.remove('cursor-note');
		prevCursorEl = null;
		if (idx === null || idx === undefined || !lastVisualObj) return;
		const anchor = lastNoteAnchors.find((a) => a.sourceIndex === idx);
		if (!anchor) return;
		const el = elementForAnchor(lastVisualObj, anchor);
		if (el) {
			el.classList.add('cursor-note');
			prevCursorEl = el;
		}
	});

	// Playback-follow scroll (teleprompter-style): translate the chart so the
	// music rides a fixed reading line in a clipped viewport. Driven every
	// frame by playheadBarFraction (continuous, like lick-practice
	// UpcomingKeysDisplay) — no CSS transition; motion is the rAF updates.
	// Falls back to the integer playhead marker when no fraction is provided.
	//
	// Geometry is derived from viewBox + layout clientWidth (ignores transforms).
	// Never remeasure via getBoundingClientRect on the live transformed SVG:
	// under overflow clipping that feedback-loops in Firefox and scrolls the
	// chart into empty space within a frame or two.
	$effect(() => {
		if (!autoScrollPlayhead) {
			followOffsetPx = 0;
			return;
		}
		const markers = rangeMarkers;
		const fraction = playheadBarFraction;
		void renderVersion;
		const sheet = tune;
		if (
			!sheet ||
			!lastViewBox ||
			!containerEl ||
			!viewportEl ||
			systemBands.length === 0 ||
			lastBarZones.length === 0
		) {
			followOffsetPx = 0;
			return;
		}

		const bases = sectionBarBases(sheet);
		// Prefer continuous fraction; else snap to the discrete playhead bar.
		let barF: number | null =
			fraction !== null && fraction !== undefined && Number.isFinite(fraction) ? fraction : null;
		if (barF === null) {
			const ph = markers?.find((m) => m.status === 'playhead');
			barF = ph ? ph.startBar : null;
		}
		if (barF === null) {
			followOffsetPx = 0;
			return;
		}

		// clientWidth is transform-independent layout width (width:100% SVG).
		const scale = svgCssScale(containerEl.clientWidth, lastViewBox.width);
		if (scale <= 0) {
			followOffsetPx = 0;
			return;
		}
		const contentPx = lastViewBox.height * scale;
		const systems = buildFollowSystems(
			lastBarZones.map((z) => ({
				absBar: bases[z.sectionIdx] + z.bar,
				systemIdx: z.systemIdx
			})),
			systemBands.map((b) => b.top * scale)
		);
		followOffsetPx = computeFollowOffset({
			systems,
			barFraction: barF,
			viewportPx: viewportEl.clientHeight,
			contentPx
		});
	});

	// Insertion-point range bands — a handful of overlay rects per status
	// change, inserted below the glyphs like the bar hit rects.
	$effect(() => {
		const markers = rangeMarkers;
		void renderVersion;
		const container = containerEl;
		if (!container) return;
		for (const stale of container.querySelectorAll('.range-marker')) stale.remove();
		const sheet = tune;
		if (!markers?.length || !sheet || systemBands.length === 0 || lastBarZones.length === 0) return;

		const sectionBases = sectionBarBases(sheet);
		const barWholeNotes = sheet.timeSignature[0] / sheet.timeSignature[1];

		for (const marker of markers) {
			// Merge the marker's bar zones into one x-run per system row.
			// With timeRange, each bar is clipped to the span first so mid-bar
			// abutments split the shared bar rather than double-painting it.
			const runs = new Map<number, { x0: number; x1: number }>();
			for (const zone of lastBarZones) {
				const absBar = sectionBases[zone.sectionIdx] + zone.bar;
				if (absBar < marker.startBar || absBar >= marker.endBarExclusive) continue;
				let x0 = zone.x0;
				let x1 = zone.x1;
				if (marker.timeRange) {
					const clipped = clipBarSpanX(
						zone.x0,
						zone.x1,
						absBar,
						barWholeNotes,
						marker.timeRange.start,
						marker.timeRange.end
					);
					if (!clipped) continue;
					x0 = clipped.x0;
					x1 = clipped.x1;
				}
				const run = runs.get(zone.systemIdx);
				if (run) {
					run.x0 = Math.min(run.x0, x0);
					run.x1 = Math.max(run.x1, x1);
				} else {
					runs.set(zone.systemIdx, { x0, x1 });
				}
			}
			let labelPlaced = false;
			// Progression hue overrides the neutral band/label fill while a lick is
			// anticipated or live; scoring states keep their green/red outcome fill.
			const bandTint =
				marker.color && (marker.status === 'upcoming' || marker.status === 'active')
					? marker.color
					: null;
			for (const systemIdx of [...runs.keys()].sort((a, b) => a - b)) {
				const run = runs.get(systemIdx)!;
				const band = systemBands[systemIdx];
				if (!band) continue;

				// The playhead gets its own geometry per style; insertion bands
				// stay a single translucent full-bar rect.
				if (marker.status === 'playhead') {
					drawPlayhead(band.wrapper, run.x0, run.x1, band, marker.id, playheadStyle);
					continue;
				}

				const spec = barHitRect(run, band);
				const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				rect.setAttribute('x', spec.x.toFixed(2));
				rect.setAttribute('y', spec.y.toFixed(2));
				rect.setAttribute('width', Math.max(0, spec.w).toFixed(2));
				rect.setAttribute('height', Math.max(0, spec.h).toFixed(2));
				rect.setAttribute('rx', '4');
				rect.setAttribute('class', `range-marker marker-${marker.status}`);
				rect.setAttribute('data-marker-id', marker.id);
				// Inline fill beats the (non-important) per-status CSS fill; the
				// per-status fill-opacity stays, so intensity still tracks status.
				if (bandTint) rect.style.fill = bandTint;
				band.wrapper.insertBefore(rect, band.wrapper.firstChild);

				// Lick/progression name inside the band, below the staff — on the
				// marker's first system wide enough to hold any text (a
				// degenerately narrow run passes the label on to the next system).
				// Truncated to the run width so long names can't bleed into the
				// next insertion point.
				// (Playhead markers already `continue`d above — never labeled.)
				if (marker.label && !labelPlaced && run.x1 - run.x0 > band.spacing * 4) {
					labelPlaced = true;
					const fontSize = band.spacing * 1.8;
					const maxChars = Math.max(3, Math.floor((run.x1 - run.x0 - band.spacing) / (fontSize * 0.58)));
					const text =
						marker.label.length > maxChars
							? marker.label.slice(0, Math.max(1, maxChars - 1)) + '…'
							: marker.label;
					const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
					el.setAttribute('x', (run.x0 + band.spacing * 0.6).toFixed(2));
					el.setAttribute('y', (band.staffBottom + band.spacing * 1.9).toFixed(2));
					el.setAttribute('font-size', fontSize.toFixed(2));
					el.setAttribute('class', `range-marker range-marker-label marker-label-${marker.status}`);
					el.setAttribute('data-marker-id', marker.id);
					// The per-status label CSS fill is `!important`, so the tint must be
					// too in order to win.
					if (bandTint) el.style.setProperty('fill', bandTint, 'important');
					el.textContent = text;
					band.wrapper.appendChild(el);
				}
			}
		}
	});

	/**
	 * Position (and re-position after every re-render) the inline chord input
	 * over its beat cell, then focus it. Closes the editor when the rendered
	 * chart no longer has the target slot.
	 */
	$effect(() => {
		const pos = chordEdit;
		void renderVersion;
		if (!pos) {
			overlayBox = null;
			return;
		}
		const zone = lastChordZones.find(
			(z) => z.sectionIdx === pos.sectionIdx && z.bar === pos.bar && z.beat === pos.beat
		);
		const band = zone ? systemBands[zone.systemIdx] : undefined;
		if (!zone || !band || !lastViewBox) {
			chordEdit = null;
			overlayBox = null;
			return;
		}
		overlayBox = overlayBoxPct(zone, lastViewBox, band.top);
		tick().then(() => {
			if (chordEdit === pos) {
				chordInputEl?.focus();
				chordInputEl?.select();
			}
		});
	});

	/** Open the inline chord editor at a form position (also for `bind:this`). */
	export function openChordEditorAt(pos: BeatPos): void {
		if (!tune || !chordEditor) return;
		chordInputValue = chordEditor.textAt(pos) ?? '';
		errorFlash = false;
		chordEdit = pos;
	}

	function closeChordEditor(): void {
		chordEdit = null;
		chordInputValue = '';
		errorFlash = false;
	}

	function flashError(): void {
		errorFlash = true;
		if (errorTimer) clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (errorFlash = false), 300);
	}

	/** Commit the input at the open position; false = invalid (and flashed). */
	function commitChord(): boolean {
		if (!chordEdit || !chordEditor) return false;
		const text = chordInputValue.trim();
		if (text === '') {
			chordEditor.clear(chordEdit);
			return true;
		}
		if (chordEditor.commit(chordEdit, text)) return true;
		flashError();
		return false;
	}

	function handleChordKeydown(e: KeyboardEvent): void {
		// The editor pages listen for note-entry keys on window — nothing
		// typed here may leak out.
		e.stopPropagation();
		if (!chordEdit || !tune) return;
		const action = chordKeyAction(e.key, e.shiftKey, chordEdit, formShape(tune));
		if (!action) return;
		if (action.preventDefault) e.preventDefault();
		if (action.type === 'close') return closeChordEditor();
		if (!commitChord()) return; // invalid: flashed, stay put
		if (action.type === 'commit-advance' && action.target) openChordEditorAt(action.target);
		else closeChordEditor();
	}

	function handleChordBlur(): void {
		if (!chordEdit) return;
		if (commitChord()) closeChordEditor();
		// Invalid text: flashed by commitChord; stay open for a fix.
	}

	/**
	 * Invisible click targets over the chart: one rect per bar (empty-space
	 * clicks → `onBarClick`) inserted BELOW the glyphs, and one per beat cell
	 * in the chord band above the staff (clicks → inline chord editor)
	 * appended ABOVE them. Rendered in SVG user units inside each system's
	 * `.abcjs-staff-wrapper`, so the responsive viewBox rescales them for free.
	 */
	function buildHitZones(
		container: HTMLDivElement,
		visualObj: AdapterVisualObj,
		anchors: {
			noteAnchors: NoteAnchor[];
			barAnchors: BarAnchor[];
			chordSlotAnchors: ChordSlotAnchor[];
		}
	): void {
		lastChordZones = [];
		systemBands = [];
		lastViewBox = null;
		lastBarZones = [];
		const sheet = tune;
		// Geometry (bands + bar zones) is measured for every tune render — the
		// range-marker effect needs it even when no hit rects are requested.
		if (!sheet) return;
		const svg = container.querySelector('svg');
		if (!svg) return;
		const vb = svg.viewBox.baseVal;
		lastViewBox = { width: vb.width, height: vb.height };

		const systems = toSystemLayouts(systemsFromVisualObj(visualObj));
		// Wrapper n ↔ system n: both follow the visualObj music-line order.
		// Measure every band BEFORE inserting rects (rects would inflate boxes).
		for (const wrapper of svg.querySelectorAll<SVGGElement>('g.abcjs-staff-wrapper')) {
			const staffEl = wrapper.querySelector<SVGGraphicsElement>('.abcjs-staff');
			if (!staffEl) break; // keep index alignment: stop at the first oddity
			const staffBox = staffEl.getBBox();
			const wrapBox = wrapper.getBBox();
			systemBands.push({ wrapper, ...bandGeometry(wrapBox.y, staffBox.y, staffBox.height) });
		}
		// Wrapper↔system alignment is load-bearing (follow-scroll + range markers
		// index into systemBands by system number). A short count means the break
		// above truncated — later zones would attach to the wrong system. Surface
		// it loudly in dev rather than mis-placing silently if abcjs's SVG shape
		// ever drifts.
		if (import.meta.env.DEV && systemBands.length !== systems.length) {
			console.warn(
				`[NotationDisplay] staff-wrapper/system count mismatch: ${systemBands.length} bands vs ` +
					`${systems.length} systems — follow-scroll and range markers may mis-attach.`
			);
		}

		lastBarZones = barZones(systems, anchors.barAnchors);

		if (onBarClick) {
			for (const zone of lastBarZones) {
				const band = systemBands[zone.systemIdx];
				if (!band) continue;
				const rect = makeHitRect(barHitRect(zone, band), 'bar-hit');
				const pos = { sectionIdx: zone.sectionIdx, bar: zone.bar };
				rect.setAttribute('data-bar-pos', `${pos.sectionIdx}:${pos.bar}`);
				rect.addEventListener('click', (e) => {
					e.stopPropagation();
					onBarClick?.(pos);
				});
				band.wrapper.insertBefore(rect, band.wrapper.firstChild);
			}
		}

		if (chordEditor) {
			lastChordZones = chordZones({
				systems,
				barAnchors: anchors.barAnchors,
				// Beat-edge interpolation samples pitched notes only, keeping the
				// chord hit-rect geometry identical to the pre-rest-anchor layout.
				noteAnchors: anchors.noteAnchors.filter((a) => !a.rest),
				chordSlotAnchors: anchors.chordSlotAnchors,
				beatsPerBar: sheet.timeSignature[0],
				barDurationWholeNotes: sheet.timeSignature[0] / sheet.timeSignature[1]
			});
			for (const zone of lastChordZones) {
				const band = systemBands[zone.systemIdx];
				if (!band) continue;
				const rect = makeHitRect(chordHitRect(zone, band), 'chord-hit');
				const pos = { sectionIdx: zone.sectionIdx, bar: zone.bar, beat: zone.beat };
				rect.setAttribute('data-chord-pos', `${pos.sectionIdx}:${pos.bar}:${pos.beat}`);
				rect.addEventListener('click', (e) => {
					e.stopPropagation();
					openChordEditorAt(pos);
				});
				band.wrapper.appendChild(rect);
			}
		}
	}

	const SVG_NS = 'http://www.w3.org/2000/svg';
	function svgEl(tag: string): SVGElement {
		return document.createElementNS(SVG_NS, tag);
	}

	/**
	 * Draw the current-bar playhead in the requested style. Every element is
	 * classed `range-marker` so the marker effect's cleanup removes it, plus a
	 * `playhead-{style}` class for CSS coloring. Colors and stroke live in the
	 * component style block (theme-token driven, legible in light + dark).
	 */
	function drawPlayhead(
		wrapper: SVGGElement,
		x0: number,
		x1: number,
		band: SystemBand,
		id: string,
		style: PlayheadStyle
	): void {
		const sp = band.spacing;
		const w = Math.max(0, x1 - x0);
		const add = (el: SVGElement, extra?: string) => {
			el.setAttribute('data-marker-id', id);
			el.classList.add('range-marker', `playhead-${style}`);
			if (extra) el.classList.add(extra);
			wrapper.insertBefore(el, wrapper.firstChild);
		};
		const rect = (x: number, y: number, width: number, height: number, rx = 0) => {
			const r = svgEl('rect');
			r.setAttribute('x', x.toFixed(2));
			r.setAttribute('y', y.toFixed(2));
			r.setAttribute('width', Math.max(0, width).toFixed(2));
			r.setAttribute('height', Math.max(0, height).toFixed(2));
			if (rx) r.setAttribute('rx', rx.toFixed(2));
			return r;
		};

		if (style === 'cursor-line') {
			const top = band.staffTop - sp;
			const line = svgEl('line');
			line.setAttribute('x1', x0.toFixed(2));
			line.setAttribute('x2', x0.toFixed(2));
			line.setAttribute('y1', top.toFixed(2));
			line.setAttribute('y2', (band.staffBottom + sp).toFixed(2));
			add(line);
			const fx = x0 + sp * 1.5;
			const fy2 = top + sp * 1.1;
			const flag = svgEl('path');
			flag.setAttribute('d', ['M', x0, top, 'L', fx, top, 'L', x0, fy2, 'Z'].join(' '));
			add(flag, 'playhead-solid');
			return;
		}
		if (style === 'under-bar') {
			add(rect(x0, band.staffBottom + sp * 0.35, w, sp * 1.3, sp * 0.35), 'playhead-solid');
			return;
		}
		if (style === 'underline-caret') {
			add(rect(x0, band.staffBottom + sp * 0.45, w, sp * 0.4, sp * 0.15), 'playhead-solid');
			const cy = band.staffBottom + sp * 0.35;
			const caret = svgEl('path');
			caret.setAttribute(
				'd',
				['M', x0, cy, 'L', x0 + sp * 0.9, cy + sp * 0.55, 'L', x0, cy + sp * 1.1, 'Z'].join(' ')
			);
			add(caret, 'playhead-solid');
			return;
		}
		// 'box' and 'wash-strong' both cover the full bar.
		const spec = barHitRect({ x0, x1 }, band);
		add(rect(spec.x, spec.y, spec.w, spec.h, 4));
	}

	function makeHitRect(spec: RectSpec, kind: string): SVGRectElement {
		const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		rect.setAttribute('x', spec.x.toFixed(2));
		rect.setAttribute('y', spec.y.toFixed(2));
		rect.setAttribute('width', Math.max(0, spec.w).toFixed(2));
		rect.setAttribute('height', Math.max(0, spec.h).toFixed(2));
		rect.setAttribute('rx', '3');
		rect.setAttribute('class', `hit-zone ${kind}`);
		// abcjs binds mousedown/mouseup AND touchstart/touchend on the SVG and
		// resolves clicks by PROXIMITY — swallow all four so a rect tap/click
		// can't double-dispatch through the clickListener as a phantom
		// note/bar hit nearby.
		const swallow = (e: Event) => e.stopPropagation();
		rect.addEventListener('mousedown', swallow);
		rect.addEventListener('mouseup', swallow);
		rect.addEventListener('touchstart', swallow);
		rect.addEventListener('touchend', swallow);
		return rect;
	}

	/**
	 * Superscript chord engraving — the app-wide pretty convention:
	 *   G⁷⁽♭⁹⁾   C-⁷   Dø⁷   with two+ alterations as a raised column in
	 *   one tall paren pair.
	 *
	 * Root and the minor "-" flow full-size on the baseline; the sup run
	 * flows right after them, small and raised (absolute y, flowing x). A
	 * multi-alteration stack chains left→right at the measured right edge:
	 * "(", the column, ")".
	 *
	 * Critical: abcjs chords use text-anchor="middle". Absolute tspan `x` is
	 * then the CENTER of that chunk, so a stack placed at mainRight paints
	 * half its width back over the sup run. We switch the element to
	 * text-anchor="start" and re-home `x` to the painted left edge so the
	 * chord stays put and the stack grows right.
	 */
	function structureChordSymbols(container: HTMLDivElement): void {
		for (const svg of container.querySelectorAll('svg')) {
			for (const el of svg.querySelectorAll<SVGTextElement>('text.abcjs-chord')) {
				const raw = (el.textContent ?? '').trim();
				if (!raw) continue;
				const model = chordDisplayModelFromText(raw);
				const bare =
					!model.baselineQuality && !model.sup && !model.supStack && !model.bass;
				// Unparseable text (root === raw) keeps abcjs's own rendering;
				// a parseable bare root may still need its accidental prettified.
				if (bare && model.root === raw) continue;

				const specs = chordTspanSpecs(model);
				const baseSize = Number.parseFloat(el.getAttribute('font-size') ?? '') || 15;
				const baseY = Number.parseFloat(el.getAttribute('y') ?? '0');

				while (el.firstChild) el.removeChild(el.firstChild);

				// ── Main line: root + minus + sup run (flowing tspans) ─────
				for (const spec of specs.filter((s) => !s.stackRight && s.role !== 'bass')) {
					const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
					tspan.setAttribute('font-size', (baseSize * spec.size).toFixed(2));
					// The sup run rises via absolute y; x keeps flowing.
					if (spec.dyEm !== 0) {
						tspan.setAttribute('y', (baseY + spec.dyEm * baseSize).toFixed(2));
					}
					tspan.setAttribute('data-chord-part', spec.role);
					tspan.textContent = spec.text;
					el.appendChild(tspan);
				}

				// Measure painted main line, then convert middle→start anchoring
				// so absolute stack `x` means "left edge", not center.
				let mainLeft = Number.parseFloat(el.getAttribute('x') ?? '0');
				let stackX = mainLeft + baseSize * 1.4;
				try {
					const mainBox = el.getBBox();
					if (Number.isFinite(mainBox.width) && mainBox.width > 0) {
						// Painted left/right in user space (correct even when the
						// element was text-anchor="middle" on a center x).
						mainLeft = mainBox.x;
						stackX = alterationStackX(mainBox, baseSize);
						// Re-home: start-anchor at the previous painted left edge
						// so the chord does not jump when we drop "middle".
						el.setAttribute('x', mainLeft.toFixed(2));
						el.setAttribute('text-anchor', 'start');
					} else {
						el.setAttribute('text-anchor', 'start');
					}
				} catch {
					// getBBox can throw if the node is not yet in the layout tree.
					el.setAttribute('text-anchor', 'start');
				}

				// ── Paren-wrapped alteration stack, chained left→right ─────
				// "(" at stackX → column rows share one x after it → ")" at the
				// widest row's right edge. Widths come from the painted glyphs,
				// with per-glyph estimates when measurement is unavailable.
				const stackSpecs = specs.filter((s) => s.stackRight);
				if (stackSpecs.length > 0) {
					const place = (spec: (typeof stackSpecs)[number], x: number): number => {
						const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
						tspan.setAttribute('x', x.toFixed(2));
						tspan.setAttribute('y', (baseY + spec.dyEm * baseSize).toFixed(2));
						tspan.setAttribute('font-size', (baseSize * spec.size).toFixed(2));
						// Explicit start so inherited middle cannot re-center a chunk.
						tspan.setAttribute('text-anchor', 'start');
						tspan.setAttribute('data-chord-part', spec.role);
						tspan.textContent = spec.text;
						el.appendChild(tspan);
						let width = baseSize * spec.size * (spec.role === 'paren' ? 0.33 : 1.0);
						try {
							const painted = tspan.getComputedTextLength();
							if (Number.isFinite(painted) && painted > 0) width = painted;
						} catch {
							// keep the estimate
						}
						return width;
					};
					const openParen = stackSpecs[0];
					const closeParen = stackSpecs[stackSpecs.length - 1];
					const rows = stackSpecs.slice(1, -1);
					const columnX = stackX + place(openParen, stackX);
					let columnRight = columnX;
					for (const row of rows) {
						columnRight = Math.max(columnRight, columnX + place(row, columnX));
					}
					place(closeParen, columnRight);
				}

				// ── Slash bass below the main symbol ──────────────────────
				const bassSpec = specs.find((s) => s.role === 'bass');
				if (bassSpec) {
					const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
					tspan.setAttribute('x', mainLeft.toFixed(2));
					tspan.setAttribute('y', (baseY + bassSpec.dyEm * baseSize).toFixed(2));
					tspan.setAttribute('font-size', (baseSize * bassSpec.size).toFixed(2));
					tspan.setAttribute('text-anchor', 'start');
					tspan.setAttribute('data-chord-part', 'bass');
					tspan.textContent = bassSpec.text;
					el.appendChild(tspan);
				}
			}
		}
	}

	/**
	 * Drop chord symbols to MuseScore's default height. abcjs parks every
	 * chord in a system above the tallest element of the WHOLE line (one
	 * high bar lifts them all); `chordSymbolDeltas` computes per-chord
	 * corrections instead — baseline 2.5 spacings above the top line,
	 * pushed up only over x-overlapping ink. Endings/parts/tempo float
	 * above the chord row by abcjs's layout and must not veto the drop.
	 * Must run BEFORE buildHitZones so the band measurements see final
	 * chord positions.
	 */
	function dropChordSymbols(container: HTMLDivElement): void {
		for (const svg of container.querySelectorAll('svg')) {
			for (const wrapper of svg.querySelectorAll<SVGGElement>('g.abcjs-staff-wrapper')) {
				const chordEls = [...wrapper.querySelectorAll<SVGTextElement>('text.abcjs-chord')];
				if (chordEls.length === 0) continue;
				const staffEl = wrapper.querySelector<SVGGraphicsElement>('.abcjs-staff');
				if (!staffEl) continue;
				const staffBox = staffEl.getBBox();
				const chords = chordEls.map((el) => ({
					baselineY: Number.parseFloat(el.getAttribute('y') ?? ''),
					box: el.getBBox()
				}));
				const obstacles = [
					...wrapper.querySelectorAll<SVGGraphicsElement>('path, ellipse, rect, circle, polygon, line, text')
				]
					.filter(
						(leaf) =>
							!leaf.closest(
								'.abcjs-chord, .abcjs-ending, .abcjs-part, .abcjs-tempo, .abcjs-rest, .abcjs-bar-number, .hit-zone'
							)
					)
					.map((leaf) => leaf.getBBox());
				const deltas = chordSymbolDeltas(chords, obstacles, staffBox.y, staffBox.height / 4);
				chordEls.forEach((el, i) => {
					if (Math.abs(deltas[i]) > 0.01) {
						el.setAttribute('transform', `translate(0, ${deltas[i].toFixed(2)})`);
					}
				});
			}
		}
	}

	/**
	 * Seat boxed rehearsal marks at the Real Book / MuseScore spot: above or
	 * just right of the treble clef on system starts, dropped toward the staff
	 * so they sit lower than the chord-symbol lane. Mid-line marks only drop.
	 */
	function repositionPartLabels(container: HTMLDivElement): void {
		for (const svg of container.querySelectorAll('svg')) {
			for (const wrapper of svg.querySelectorAll<SVGGElement>('g.abcjs-staff-wrapper')) {
				const staffEl = wrapper.querySelector<SVGGraphicsElement>('.abcjs-staff');
				if (!staffEl) continue;
				const staffBox = staffEl.getBBox();
				const spacing = staffBox.height / 4;
				if (!Number.isFinite(spacing) || spacing <= 0) continue;

				const clefEl = wrapper.querySelector<SVGGraphicsElement>('.abcjs-clef');
				const clefBox = clefEl ? clefEl.getBBox() : null;
				// Bar numbers share the system-start corner — keep the mark above them.
				const barNumberBoxes: { x: number; y: number; width: number; height: number }[] = [];
				for (const bn of wrapper.querySelectorAll<SVGGraphicsElement>(
					'.abcjs-bar-number, text.abcjs-bar-number'
				)) {
					try {
						const b = bn.getBBox();
						if (Number.isFinite(b.width) && b.width > 0) {
							barNumberBoxes.push({ x: b.x, y: b.y, width: b.width, height: b.height });
						}
					} catch {
						/* skip */
					}
				}

				// abcjs may put the part class on a group (letter + box) or a text node.
				const partEls = [
					...wrapper.querySelectorAll<SVGGElement>('g.abcjs-part'),
					...[...wrapper.querySelectorAll<SVGTextElement>('text.abcjs-part')].filter(
						(t) => !t.closest('g.abcjs-part')
					)
				];
				for (const part of partEls) {
					let box: DOMRect;
					try {
						box = part.getBBox();
					} catch {
						continue;
					}
					if (!Number.isFinite(box.width) || box.width <= 0) continue;
					const { dx, dy } = partLabelDelta(
						{ x: box.x, y: box.y, width: box.width, height: box.height },
						clefBox
							? { x: clefBox.x, y: clefBox.y, width: clefBox.width, height: clefBox.height }
							: null,
						staffBox.y,
						staffBox.width,
						spacing,
						barNumberBoxes
					);
					if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
					const prev = part.getAttribute('transform') ?? '';
					const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(prev);
					const dx0 = m ? Number.parseFloat(m[1]) : 0;
					const dy0 = m ? Number.parseFloat(m[2]) : 0;
					part.setAttribute(
						'transform',
						`translate(${(dx0 + dx).toFixed(2)}, ${(dy0 + dy).toFixed(2)})`
					);
				}
			}
		}
	}

	/**
	 * Horizontal micro-layout: nudge overlapping neighbouring chords (and
	 * chords sitting on tall ink) rightward so stacked symbols stay readable.
	 * Composes with any vertical translate already set by dropChordSymbols.
	 */
	function nudgeChordSymbols(container: HTMLDivElement): void {
		for (const svg of container.querySelectorAll('svg')) {
			for (const wrapper of svg.querySelectorAll<SVGGElement>('g.abcjs-staff-wrapper')) {
				const chordEls = [...wrapper.querySelectorAll<SVGTextElement>('text.abcjs-chord')];
				if (chordEls.length < 1) continue;
				const staffEl = wrapper.querySelector<SVGGraphicsElement>('.abcjs-staff');
				if (!staffEl) continue;
				const spacing = staffEl.getBBox().height / 4;
				const boxes = chordEls.map((el) => el.getBBox());
				const obstacles = [
					...wrapper.querySelectorAll<SVGGraphicsElement>('path, ellipse, rect, circle, polygon, line')
				]
					.filter(
						(leaf) =>
							!leaf.closest(
								'.abcjs-chord, .abcjs-ending, .abcjs-part, .abcjs-tempo, .abcjs-bar-number, .hit-zone, .range-marker'
							)
					)
					.map((leaf) => leaf.getBBox());
				const dxs = chordHorizontalNudges(boxes, obstacles, spacing);
				chordEls.forEach((el, i) => {
					if (Math.abs(dxs[i]) < 0.01) return;
					const prev = el.getAttribute('transform') ?? '';
					const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(prev);
					const dy = m ? Number.parseFloat(m[2]) : 0;
					const dx0 = m ? Number.parseFloat(m[1]) : 0;
					el.setAttribute(
						'transform',
						`translate(${(dx0 + dxs[i]).toFixed(2)}, ${dy.toFixed(2)})`
					);
				});
			}
		}
	}

	/** The rendered SVG group for an anchor's note, resolved by charspan. */
	function elementForAnchor(
		visualObj: AdapterVisualObj,
		anchor: NoteAnchor
	): SVGGraphicsElement | null {
		const el = findVoiceItem(visualObj, anchor.startChar)?.abselem?.elemset?.[0];
		return el instanceof SVGGraphicsElement ? el : null;
	}

	/**
	 * MuseScore-style glissando: a wavy line connecting the two noteheads
	 * (abcjs has no native glissando). Anchors flag the SOURCE note; the
	 * target is the next pitched note. Pairs split across rendered lines
	 * are skipped, as are pairs too close to fit a wave.
	 */
	function drawGlissandi(visualObj: AdapterVisualObj, anchors: NoteAnchor[]): void {
		anchors.forEach((anchor, i) => {
			if (!anchor.gliss) return;
			const tgtAnchor = anchors.slice(i + 1).find((a) => !a.rest);
			if (!tgtAnchor) return;
			const src = elementForAnchor(visualObj, anchor);
			const tgt = elementForAnchor(visualObj, tgtAnchor);
			if (!src || !tgt) return;
			const svg = src.ownerSVGElement;
			if (!svg || tgt.ownerSVGElement !== svg) return;
			const staff = svg.querySelector('.abcjs-staff') as SVGGraphicsElement | null;
			if (!staff) return;
			const spacing = staff.getBBox().height / 4;
			const srcHead = (src.querySelector('.abcjs-notehead') ?? src) as SVGGraphicsElement;
			const tgtHead = (tgt.querySelector('.abcjs-notehead') ?? tgt) as SVGGraphicsElement;
			const wave = glissandoWave(srcHead.getBBox(), tgtHead.getBBox(), spacing);
			if (!wave) return;
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', wave.d);
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke', 'currentColor');
			path.setAttribute('stroke-width', wave.strokeWidth);
			path.setAttribute('stroke-linecap', 'round');
			path.setAttribute('class', 'abcjs-glissando');
			svg.appendChild(path);
		});
	}

	/** Colour the selected element's group(s), resolved from anchor charspans. */
	function applySelectionHighlight(
		visualObj: AdapterVisualObj,
		anchors: NoteAnchor[],
		index: number | null
	): void {
		if (index === null) return;
		// A fanned-out source rest owns several display segments — highlight all
		// of them. A source rest swallowed by a merged display rest has no exact
		// anchor; fall back to the rest anchor whose source range contains it.
		let targets = anchors.filter((a) => a.sourceIndex === index);
		if (targets.length === 0) {
			targets = anchors.filter(
				(a) =>
					a.rest &&
					a.sourceIndexEnd !== undefined &&
					index >= a.sourceIndex &&
					index <= a.sourceIndexEnd
			);
		}
		for (const anchor of targets) {
			elementForAnchor(visualObj, anchor)?.classList.add('selected-note');
		}
	}
</script>

<div
	class="notation-container {frameless ? 'frameless' : 'rounded-lg p-4'}"
	class:chart-practice={variant === 'practice'}
	class:chart-print={variant === 'print'}
	class:has-custom-title={!!titleArea || variant === 'practice'}
	class:has-engraved-masthead={showEngravedMasthead}
	data-chart-variant={variant}
>
	<!-- "Chart" liner — practice chrome only; print mode lets the engraved
	     masthead own the top of the page. -->
	{#if variant === 'practice' && !frameless}
		<div class="mb-4 flex items-center gap-2">
			<span class="smallcaps text-[var(--color-brass)]">Chart</span>
			<div class="jazz-rule flex-1"></div>
		</div>
	{/if}
	{#if titleArea}
		{@render titleArea()}
	{/if}
	{#if phrase || tune}
		<div class="relative">
			<!-- Fixed-height teleprompter viewport while following; transform lives on
			     an inner layer so abcjs's render root is never the transformed node. -->
			<div
				bind:this={viewportEl}
				class="chart-scroll-viewport"
				class:following={autoScrollPlayhead}
				data-testid="chart-scroll-viewport"
				data-follow-offset={autoScrollPlayhead ? String(followOffsetPx) : undefined}
			>
				<div
					class="chart-follow-layer"
					style={autoScrollPlayhead ? `transform: translateY(${followOffsetPx}px)` : undefined}
				>
					<div bind:this={containerEl} class="abcjs-container"></div>
				</div>
			</div>
			{#if chordEdit && overlayBox}
				<input
					bind:this={chordInputEl}
					bind:value={chordInputValue}
					onkeydown={handleChordKeydown}
					onblur={handleChordBlur}
					autocomplete="off"
					spellcheck="false"
					data-testid="chord-input"
					aria-label="Chord at section {chordEdit.sectionIdx + 1}, bar {chordEdit.bar + 1}, beat {chordEdit.beat + 1}"
					style="left: {overlayBox.leftPct}%; top: {overlayBox.topPct}%; width: {overlayBox.widthPct}%"
					class="absolute z-10 rounded px-1 py-0.5 text-center text-xs outline-none ring-2 {errorFlash
						? 'bg-[var(--color-error)]/15 ring-[var(--color-error)]'
						: 'bg-[var(--color-bg-secondary)] ring-[var(--color-accent)]'}"
				/>
			{/if}
		</div>
	{:else}
		<div class="flex h-24 items-center justify-center italic text-[var(--color-text-secondary)]">
			No phrase loaded
		</div>
	{/if}
</div>

<style>
	.notation-container :global(svg) {
		width: 100%;
		max-width: 100%;
	}
	/* Playback-follow viewport: fixed height teleprompter window (like lick
	   practice's fixed row stack) — not max-height, so clientHeight cannot
	   collapse when transformed content is measured. Idle, it is inert so the
	   chart lays out and the inline chord editor overlays as before. */
	.chart-scroll-viewport.following {
		height: 60vh;
		overflow: hidden;
	}
	/* Continuous follow-scroll: motion is rAF-driven translateY (no CSS
	   transition — same model as lick-practice UpcomingKeysDisplay). */
	.chart-scroll-viewport.following .chart-follow-layer {
		will-change: transform;
	}

	/* ── Practice (dark): hierarchical ink, not flat recolor ─────────────── */
	.chart-practice {
		background: var(--color-bg-secondary);
	}
	/* A frameless chart lives inside its host's frame — no panel of its own. */
	.notation-container.frameless {
		background: transparent;
	}
	/* Staff lines: lighter than noteheads so the music reads first. */
	.chart-practice :global(svg .abcjs-staff path),
	.chart-practice :global(svg .abcjs-staff line) {
		stroke: color-mix(in srgb, var(--color-text) 42%, transparent) !important;
		fill: none !important;
	}
	/* Barlines slightly stronger than staff. */
	.chart-practice :global(svg .abcjs-bar path),
	.chart-practice :global(svg .abcjs-bar line),
	.chart-practice :global(svg .abcjs-bar rect) {
		stroke: color-mix(in srgb, var(--color-text) 78%, transparent) !important;
	}
	/* Noteheads / stems / beams / rests — full ink. */
	.chart-practice :global(svg .abcjs-note path),
	.chart-practice :global(svg .abcjs-note ellipse),
	.chart-practice :global(svg .abcjs-note circle),
	.chart-practice :global(svg .abcjs-note line),
	.chart-practice :global(svg .abcjs-rest path),
	.chart-practice :global(svg .abcjs-rest line),
	.chart-practice :global(svg .abcjs-beam path),
	.chart-practice :global(svg .abcjs-beam line),
	.chart-practice :global(svg .abcjs-ledger path),
	.chart-practice :global(svg .abcjs-ledger line),
	.chart-practice :global(svg .abcjs-stem path),
	.chart-practice :global(svg .abcjs-stem line),
	.chart-practice :global(svg .abcjs-slur path),
	.chart-practice :global(svg .abcjs-tie path),
	.chart-practice :global(svg .abcjs-glissando) {
		stroke: var(--color-text) !important;
	}
	.chart-practice :global(svg .abcjs-note path),
	.chart-practice :global(svg .abcjs-note ellipse),
	.chart-practice :global(svg .abcjs-note circle),
	.chart-practice :global(svg .abcjs-rest path) {
		fill: var(--color-text) !important;
	}
	/* Clefs / time / key — mid weight. */
	.chart-practice :global(svg .abcjs-clef path),
	.chart-practice :global(svg .abcjs-time-signature path),
	.chart-practice :global(svg .abcjs-key-signature path),
	.chart-practice :global(svg .abcjs-accidental path) {
		stroke: color-mix(in srgb, var(--color-text) 88%, transparent) !important;
		fill: color-mix(in srgb, var(--color-text) 88%, transparent) !important;
	}
	/* Chord symbols: the app-wide chord face (Fraunces + Edwin glyphs). */
	.chart-practice :global(svg text.abcjs-chord),
	.chart-practice :global(svg .abcjs-chord) {
		fill: var(--color-text) !important;
		font-family: var(--chord-font) !important;
		font-weight: var(--chord-font-weight);
	}
	/* Rehearsal marks — bold letter + hollow square (abcjs path box). */
	.chart-practice :global(svg text.abcjs-part),
	.chart-practice :global(svg .abcjs-part) {
		fill: var(--color-text) !important;
		font-family: Fraunces, Georgia, 'Times New Roman', serif !important;
		font-weight: 700;
	}
	/* abcjs draws the box as a filled path frame (stroke:none); paint with ink. */
	.chart-practice :global(svg .abcjs-part path[data-name='box']),
	.chart-practice :global(svg g.abcjs-part path[data-name='box']) {
		fill: var(--color-text) !important;
		stroke: none !important;
	}
	.chart-practice :global(svg text) {
		fill: var(--color-text) !important;
	}

	/* ── Print / stand chart: masthead on, theme-aware paper ───────────────
	   Dark app theme keeps the dark secondary surface (no forced cream paper).
	   Light theme gets Real Book off-white. Ink follows --color-text. */
	.chart-print {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border: 1px solid color-mix(in srgb, var(--color-text) 12%, transparent);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--color-text) 6%, transparent);
	}
	:global(:root.light) .chart-print {
		background: #f7f4ec;
		color: #1a1a1a;
		border-color: color-mix(in srgb, #1a1a1a 12%, transparent);
	}
	.chart-print :global(svg .abcjs-staff path),
	.chart-print :global(svg .abcjs-staff line) {
		stroke: color-mix(in srgb, var(--color-text) 45%, transparent) !important;
		fill: none !important;
	}
	:global(:root.light) .chart-print :global(svg .abcjs-staff path),
	:global(:root.light) .chart-print :global(svg .abcjs-staff line) {
		stroke: color-mix(in srgb, #1a1a1a 45%, transparent) !important;
	}
	.chart-print :global(svg .abcjs-bar path),
	.chart-print :global(svg .abcjs-bar line),
	.chart-print :global(svg .abcjs-bar rect) {
		stroke: var(--color-text) !important;
	}
	.chart-print :global(svg path),
	.chart-print :global(svg line) {
		stroke: var(--color-text) !important;
	}
	.chart-print :global(svg .abcjs-note path),
	.chart-print :global(svg .abcjs-note ellipse),
	.chart-print :global(svg .abcjs-note circle),
	.chart-print :global(svg .abcjs-rest path) {
		fill: var(--color-text) !important;
		stroke: var(--color-text) !important;
	}
	.chart-print :global(svg text) {
		fill: var(--color-text) !important;
	}
	:global(:root.light) .chart-print :global(svg .abcjs-bar path),
	:global(:root.light) .chart-print :global(svg .abcjs-bar line),
	:global(:root.light) .chart-print :global(svg .abcjs-bar rect),
	:global(:root.light) .chart-print :global(svg path),
	:global(:root.light) .chart-print :global(svg line) {
		stroke: #1a1a1a !important;
	}
	:global(:root.light) .chart-print :global(svg .abcjs-note path),
	:global(:root.light) .chart-print :global(svg .abcjs-note ellipse),
	:global(:root.light) .chart-print :global(svg .abcjs-note circle),
	:global(:root.light) .chart-print :global(svg .abcjs-rest path) {
		fill: #1a1a1a !important;
		stroke: #1a1a1a !important;
	}
	:global(:root.light) .chart-print :global(svg text) {
		fill: #1a1a1a !important;
	}
	.chart-print :global(svg text.abcjs-chord),
	.chart-print :global(svg .abcjs-chord) {
		font-family: var(--chord-font) !important;
		font-weight: var(--chord-font-weight);
	}
	.chart-print :global(svg text.abcjs-title) {
		font-family: Fraunces, Georgia, 'Times New Roman', serif !important;
		font-weight: 600;
	}
	.chart-print :global(svg text.abcjs-composer),
	.chart-print :global(svg text.abcjs-rhythm) {
		font-family: Fraunces, Georgia, 'Times New Roman', serif !important;
	}
	.chart-print :global(svg text.abcjs-part),
	.chart-print :global(svg .abcjs-part) {
		font-family: Fraunces, Georgia, 'Times New Roman', serif !important;
		font-weight: 700;
	}
	.chart-print :global(svg .abcjs-part path[data-name='box']),
	.chart-print :global(svg g.abcjs-part path[data-name='box']) {
		fill: var(--color-text) !important;
		stroke: none !important;
	}
	:global(:root.light) .chart-print :global(svg .abcjs-part path[data-name='box']),
	:global(:root.light) .chart-print :global(svg g.abcjs-part path[data-name='box']) {
		fill: #1a1a1a !important;
	}
	/* Measure numbers — quiet navigation marks at system starts. */
	/* Measure numbers — quiet, small navigation marks at system starts. */
	.chart-practice :global(svg .abcjs-bar-number),
	.chart-practice :global(svg text.abcjs-bar-number),
	.chart-print :global(svg .abcjs-bar-number),
	.chart-print :global(svg text.abcjs-bar-number) {
		font-family: Fraunces, Georgia, 'Times New Roman', serif !important;
		font-style: italic;
		opacity: 0.5;
		font-size: 0.72em;
	}
	/* Stacked [2] volta/beam line art may be matrix-scaled; keep strokes crisp.
	   Notes/chords/bars use pure translate only (see ending-align-dom). */
	.notation-container :global(svg g.abcjs-ending-align g.abcjs-ending path),
	.notation-container :global(svg g.abcjs-ending-align g.abcjs-ending line) {
		vector-effect: non-scaling-stroke;
	}
	/* Structured chord parts — root/minus on the baseline, the rest raised. */
	.notation-container :global(svg text.abcjs-chord tspan[data-chord-part='paren']) {
		opacity: 0.85;
	}
	.notation-container :global(svg text.abcjs-chord tspan[data-chord-part='bass']) {
		opacity: 0.9;
	}

	/* Invisible click targets over the chart; hover hints at the live zone */
	.notation-container :global(svg .hit-zone) {
		fill: transparent;
		stroke: none;
	}
	.notation-container :global(svg .bar-hit) {
		cursor: pointer;
	}
	.notation-container :global(svg .bar-hit:hover) {
		fill: var(--color-accent);
		fill-opacity: 0.05;
	}
	.notation-container :global(svg .chord-hit) {
		cursor: text;
	}
	.notation-container :global(svg .chord-hit:hover) {
		fill: var(--color-accent);
		fill-opacity: 0.08;
	}
	/* Practice mode: page UI owns the title; suppress abcjs masthead. */
	.notation-container.has-custom-title :global(.abcjs-title),
	.chart-practice :global(.abcjs-title),
	.chart-practice :global(.abcjs-composer),
	.chart-practice :global(.abcjs-rhythm) {
		display: none;
	}
	/* Cursor affordance: notes and rests are clickable */
	.notation-container :global(.abcjs-note),
	.notation-container :global(.abcjs-rest) {
		cursor: pointer;
	}
	/* User-selected element — colored notehead + stem (or rest glyph) so it
	   stands out on the staff. Includes the group itself in case abcjs renders
	   the glyph directly on that element rather than on a child path/ellipse/
	   circle. abcjs classes rests .abcjs-rest, not .abcjs-note. */
	.notation-container :global(.abcjs-note.selected-note),
	.notation-container :global(.abcjs-note.selected-note path),
	.notation-container :global(.abcjs-note.selected-note ellipse),
	.notation-container :global(.abcjs-note.selected-note circle),
	.notation-container :global(.abcjs-rest.selected-note),
	.notation-container :global(.abcjs-rest.selected-note path) {
		fill: var(--color-accent) !important;
		stroke: var(--color-accent) !important;
	}
	.notation-container :global(.abcjs-note.selected-note line) {
		stroke: var(--color-accent) !important;
	}
	/* Playback cursor — brass to contrast the accent-colored selection.
	   Declared after selected-note so the cursor wins if both land on one note. */
	.notation-container :global(.abcjs-note.cursor-note),
	.notation-container :global(.abcjs-note.cursor-note path),
	.notation-container :global(.abcjs-note.cursor-note ellipse),
	.notation-container :global(.abcjs-note.cursor-note circle) {
		fill: var(--color-brass) !important;
		stroke: var(--color-brass) !important;
	}
	.notation-container :global(.abcjs-note.cursor-note line) {
		stroke: var(--color-brass) !important;
	}
	/* Insertion-point range bands — translucent status tints under the glyphs. */
	.notation-container :global(svg .range-marker) {
		stroke: none;
		pointer-events: none;
	}
	.notation-container :global(svg .range-marker.marker-upcoming) {
		fill: var(--color-accent);
		fill-opacity: 0.08;
	}
	.notation-container :global(svg .range-marker.marker-active) {
		fill: var(--color-phase-play);
		fill-opacity: 0.18;
	}
	.notation-container :global(svg .range-marker.marker-hit) {
		fill: var(--color-success);
		fill-opacity: 0.12;
	}
	.notation-container :global(svg .range-marker.marker-missed) {
		fill: var(--color-error);
		fill-opacity: 0.1;
	}
	/* Moving current-bar playhead — geometry set in drawPlayhead(); these rules
	   own the color. Class-specificity beats the global svg line/path stroke
	   override even though both are !important, so lines/carets keep their
	   color in dark mode. */
	.notation-container :global(svg .playhead-under-bar) {
		fill: var(--color-brass);
		fill-opacity: 0.9;
		stroke: none !important;
	}
	.notation-container :global(svg .playhead-cursor-line) {
		stroke: var(--color-onair) !important;
		stroke-width: 2.6;
		fill: var(--color-onair) !important;
	}
	.notation-container :global(svg .playhead-cursor-line.playhead-solid) {
		stroke: none !important;
	}
	.notation-container :global(svg .playhead-box) {
		fill: none;
		stroke: var(--color-brass) !important;
		stroke-width: 2;
	}
	.notation-container :global(svg .playhead-wash-strong) {
		fill: var(--color-brass);
		fill-opacity: 0.24;
		stroke: var(--color-brass) !important;
		stroke-width: 1;
		stroke-opacity: 0.55;
	}
	.notation-container :global(svg .playhead-underline-caret) {
		fill: var(--color-brass-soft);
		fill-opacity: 0.95;
		stroke: none !important;
	}
	/* Band labels (lick / progression names) — colored to match their band.
	   The dark-mode text rule targets svg text broadly, so these need !important
	   to keep their band color. */
	.notation-container :global(svg text.range-marker-label) {
		stroke: none !important;
		font-weight: 600;
		pointer-events: none;
	}
	.notation-container :global(svg text.range-marker-label.marker-label-upcoming) {
		fill: var(--color-accent) !important;
	}
	.notation-container :global(svg text.range-marker-label.marker-label-active) {
		fill: var(--color-phase-play) !important;
	}
	.notation-container :global(svg text.range-marker-label.marker-label-hit) {
		fill: var(--color-success) !important;
	}
	.notation-container :global(svg text.range-marker-label.marker-label-missed) {
		fill: var(--color-error) !important;
	}
</style>
