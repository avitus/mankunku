import type { Tune } from '$lib/types/tune';
import type { BackingStyle } from '$lib/types/instruments';
import { settings } from './settings.svelte';
import { melodySwingForStyle } from '$lib/audio/backing-styles';
import { tuneToPhraseWithFlat } from '$lib/tunes/to-phrase';
import { playbackBarForSessionBar, notationBarForPlaybackBar } from './tune-practice-plan';
import { clampTuneTempo, savedTuneTempo } from '$lib/tunes/tune-tempo';
import { formLoopRegion } from '$lib/tunes/form-loop';
import { loopPlaybackBar } from '$lib/audio/phrase-loop';
import { countInBarsForTempo } from '$lib/audio/drum-count-in';
import { isInPickupLeadIn } from '$lib/music/pickup';
import { buildJamForm } from '$lib/tunes/jam-form';
import { savedSoloChoruses, saveSoloChoruses } from '$lib/tunes/solo-choruses';

/** Where a desk player keeps its tempo: the open tune's id and how to save a choice for it. */
export interface TuneTempoStore {
	tuneId: () => string | undefined;
	save: (tuneId: string, tempo: number) => void;
}

/** Local listening controls shared by the tune desk and its compact editor preview. */
export class TunePlayer {
	private previewTempo = $state<number | null>(null);
	backing = $state(false);
	melody = $state(true);
	metronome = $state(false);
	loop = $state(false); // Compact editor preview only.
	soloChoruses = $state(1);
	phase = $state<'head' | 'solo' | 'outro'>('head');
	soloChorus = $state(0);
	restoreSoloChoruses(): void { this.soloChoruses = savedSoloChoruses(); }
	setSoloChoruses(value: number): void { this.stop(); this.soloChoruses = saveSoloChoruses(value); }
	playing = $state(false);
	starting = $state(false);
	error = $state('');
	chartBar = $state<number | null>(null);
	cursorIndex = $state<number | null>(null);
	private playback: typeof import('$lib/audio/playback') | null = null;
	private run = 0;
	private disposed = false;
	private ticker: ReturnType<typeof setInterval> | undefined;

	/** Without a store (the editor preview) a tempo change lasts only as long as the player. */
	constructor(private readonly tempoStore?: TuneTempoStore) {}

	/** The preview tempo while one is set, else this tune's saved tempo, else the default. */
	get tempo(): number {
		const id = this.tempoStore?.tuneId();
		const saved = id === undefined ? undefined : savedTuneTempo(settings.tuneTempos, id);
		return this.previewTempo ?? saved ?? settings.defaultTempo;
	}
	get busy(): boolean { return this.playing || this.starting; }

	/** Tempo changes stop the current pass before updating its timing; the desk saves them per tune. */
	setTempo(value: number): void {
		this.stop();
		const tempo = clampTuneTempo(value);
		if (!this.tempoStore) { this.previewTempo = tempo; return; }
		const id = this.tempoStore.tuneId();
		if (id !== undefined) this.tempoStore.save(id, tempo);
	}

	/** Cancel scheduled audio, late instrument loads and visual callbacks together. */
	stop(): void {
		this.run++;
		if (this.playing) this.playback?.stopPlayback();
		clearInterval(this.ticker);
		this.ticker = undefined;
		this.playing = false;
		this.starting = false;
		this.chartBar = null;
		this.cursorIndex = null;
		this.phase = 'head';
		this.soloChorus = 0;
	}

	/**
	 * One engine call carries the complete finite jam on the tune page. The
	 * compact editor preview keeps its existing optional loop. Both preserve
	 * the saved feel, pickup entrance and original chart coordinates.
	 */
	async toggle(tune: Tune, style: BackingStyle, soloChoruses?: number): Promise<void> {
		if (this.busy) { this.stop(); return; }
		const generation = ++this.run;
		this.starting = true;
		this.error = '';
		const tempo = this.tempo;
		const backing = this.backing;
		const melody = this.melody;
		const countInBars = countInBarsForTempo(tempo);
		try {
			const expanded = tuneToPhraseWithFlat(tune, { expandRepeats: true });
			const jam = soloChoruses === undefined ? null : buildJamForm(tune, soloChoruses);
			const phrase = jam?.phrase ?? expanded.phrase;
			const flat = jam?.flat ?? expanded.flat;
			this.playback ??= await import('$lib/audio/playback');
			if (this.disposed || generation !== this.run) return;
			await this.playback.loadInstrument(settings.instrumentId, settings.masterVolume, backing ? settings.backingInstrument : undefined);
			if (this.disposed || generation !== this.run) return;
			this.starting = false;
			this.playing = true;
			const region = formLoopRegion(tune, flat);
			/** Returns to the top the engine has taken — where the marker is after each pass. */
			let returns = 0;
			/** The engine's question one tick before each top: round again, or out. */
			const shouldContinue = (): boolean => {
				const again = this.loop && generation === this.run && !this.disposed;
				if (again) returns++;
				return again;
			};
			await this.playback.playPhrase(phrase, {
				tempo, swing: melodySwingForStyle(settings.swing, style),
				countInBeats: 0, metronomeEnabled: this.metronome, metronomeVolume: settings.metronomeVolume,
				backingTrackEnabled: backing, backingInstrument: settings.backingInstrument,
				backingTrackVolume: settings.backingTrackVolume, backingStyle: style
			}, false, {
				skipMelody: !melody,
				// The drummer counts the tune in whenever the band's kit is loaded,
				// on through a pickup bar: the band enters after it.
				countIn: { bars: countInBars, drums: true, pickup: isInPickupLeadIn(tune, 0) },
				loop: jam ? undefined : { ...region, shouldContinue },
				loopBacking: jam ? false : undefined,
				onStarted: () => {
					if (generation !== this.run) return;
					clearInterval(this.ticker);
					/** Move the chart's bar marker to the bar the audible music is in. */
					const update = (): void => {
						if (generation !== this.run) return;
						const playback = this.playback;
						if (!playback) return;
						const seconds = playback.getAudibleTransportSeconds();
						// The form starts after the count-in, not at transport 0. The engine's
						// bar is timeSignature[0] quarter notes (two printed bars of 6/8).
						const leadInQuarters = countInBars * tune.timeSignature[0];
						const printedBarQuarters = tune.timeSignature[0] * 4 / tune.timeSignature[1];
						const bar = (seconds * tempo / 60 - leadInQuarters) / printedBarQuarters;
						// Past the last bar a looping form is back at its first (never the
						// pickup) for every return taken, then on its way-out pass. A
						// pickup bar is marked from its first printed beat, not its silent
						// lead-in, which is still the count.
						const sourceBar = jam
							? playbackBarForSessionBar(bar, flat.totalBars, jam.headBars, jam.practiceStartBar, jam.outroStartBar, jam.outroSourceStartBar)
							: loopPlaybackBar(bar, region, returns);
						if (jam) {
							this.phase = bar < jam.headBars ? 'head' : jam.outroStartBar !== null && bar >= jam.outroStartBar ? 'outro' : 'solo';
							this.soloChorus = this.phase === 'solo' ? Math.min(soloChoruses!, 1 + Math.floor((bar - jam.headBars) / (flat.totalBars - jam.practiceStartBar))) : 0;
							if (this.phase === 'solo') this.cursorIndex = null;
						}
						const chartBar = notationBarForPlaybackBar(flat.sectionMap, tune.sections, sourceBar);
						this.chartBar = chartBar !== null && isInPickupLeadIn(tune, chartBar) ? null : chartBar;
					};
					update();
					this.ticker = setInterval(update, 50);
				},
				onNote: ({ sourceIndex }) => {
					if (generation === this.run) this.cursorIndex = (jam?.noteSourceIndices ?? flat.noteSourceIndices)[sourceIndex] ?? null;
				}
			});
		} catch {
			if (!this.disposed && generation === this.run) this.error = 'Playback could not start. Please try again.';
		} finally {
			if (generation === this.run) this.stop();
		}
	}

	/** Tear down the player when its route or editor is destroyed. */
	dispose(): void { this.disposed = true; this.stop(); }
}
