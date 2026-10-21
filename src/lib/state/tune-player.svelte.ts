import type { Tune } from '$lib/types/tune';
import type { BackingStyle } from '$lib/types/instruments';
import { settings } from './settings.svelte';
import { melodySwingForStyle } from '$lib/audio/backing-styles';
import { tuneToPhraseWithFlat } from '$lib/tunes/to-phrase';
import { notationBarForPlaybackBar } from './tune-practice-plan';

/** Local listening controls shared by the tune desk and its compact editor preview. */
export class TunePlayer {
	private previewTempo = $state<number | null>(null);
	backing = $state(false);
	melody = $state(true);
	metronome = $state(false);
	loop = $state(false);
	playing = $state(false);
	starting = $state(false);
	error = $state('');
	chartBar = $state<number | null>(null);
	cursorIndex = $state<number | null>(null);
	private playback: typeof import('$lib/audio/playback') | null = null;
	private run = 0;
	private disposed = false;
	private ticker: ReturnType<typeof setInterval> | undefined;

	get tempo(): number { return this.previewTempo ?? settings.defaultTempo; }
	get busy(): boolean { return this.playing || this.starting; }

	/** Tempo changes stop the current pass before updating its timing. */
	setTempo(value: number): void {
		this.stop();
		this.previewTempo = Math.max(40, Math.min(240, Math.round(Number.isFinite(value) ? value : 100)));
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
	}

	/** Play the expanded form with the saved style; no global settings are changed. */
	async toggle(tune: Tune, style: BackingStyle): Promise<void> {
		if (this.busy) { this.stop(); return; }
		const generation = ++this.run;
		this.starting = true;
		this.error = '';
		const tempo = this.tempo;
		const backing = this.backing;
		const melody = this.melody;
		try {
			const { phrase, flat } = tuneToPhraseWithFlat(tune, { expandRepeats: true });
			this.playback ??= await import('$lib/audio/playback');
			if (this.disposed || generation !== this.run) return;
			await this.playback.loadInstrument(settings.instrumentId, settings.masterVolume, backing ? settings.backingInstrument : undefined);
			if (this.disposed || generation !== this.run) return;
			this.starting = false;
			this.playing = true;
			do {
				const startedAt = performance.now();
				await this.playback.playPhrase(phrase, {
					tempo, swing: melodySwingForStyle(settings.swing, style),
					countInBeats: 0, metronomeEnabled: this.metronome, metronomeVolume: settings.metronomeVolume,
					backingTrackEnabled: backing, backingInstrument: settings.backingInstrument,
					backingTrackVolume: settings.backingTrackVolume, backingStyle: style
				}, false, {
					skipMelody: !melody,
					onStarted: () => {
						if (generation !== this.run) return;
						clearInterval(this.ticker);
						const update = (): void => {
							if (generation !== this.run) return;
							const seconds = this.playback?.getAudibleTransportSeconds() ?? 0;
							const bar = seconds * tempo / 60 / (tune.timeSignature[0] * 4 / tune.timeSignature[1]);
							this.chartBar = notationBarForPlaybackBar(flat.sectionMap, tune.sections, bar);
						};
						update();
						this.ticker = setInterval(update, 50);
					},
					onNote: ({ sourceIndex }) => {
						if (generation === this.run) this.cursorIndex = flat.noteSourceIndices[sourceIndex] ?? null;
					}
				});
				// An engine-side early return must not spin an endless microtask loop.
				if (performance.now() - startedAt < 50) break;
			} while (this.loop && generation === this.run && !this.disposed);
		} catch {
			if (!this.disposed && generation === this.run) this.error = 'Playback could not start. Please try again.';
		} finally {
			if (generation === this.run) this.stop();
		}
	}

	/** Tear down the player when its route or editor is destroyed. */
	dispose(): void { this.disposed = true; this.stop(); }
}
