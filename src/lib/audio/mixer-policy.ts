/** Shared amplitude policy. Musical velocity is separate from every user fader. */
export const MIXER_DEFAULTS: Readonly<MixerLevels> = { master: 0.8, melody: 1, click: 0.5, backing: 0.6 };
export interface MixerLevels { master: number; melody: number; click: number; backing: number }

/** Explicitly replace smplr's old (100 / 127)² channel default in calibration. */
export const SAMPLE_CHANNEL_REFERENCE = (100 / 127) ** 2;
export const SAMPLE_OPTIONS = { volume: 127 } as const;
export const SOUNDFONT_OPTIONS = { volume: 127, extraGain: 1 } as const;
export const SOUNDFONT_REFERENCE = SAMPLE_CHANNEL_REFERENCE * 5;
export const CLICK_CALIBRATION = 0.6;
export const MICROPHONE_RECORDING_GAIN = 0.4;
/** Fixed compressor drive preserves the measured reference; the user fader follows it. */
export const BACKING_INPUT_REFERENCE = 0.6;
export const BACKING_OUTPUT_REFERENCE = 4;
export const OUTPUT_CEILING = 10 ** (-1 / 20);

/** Clamp an untrusted linear amplitude without admitting NaN into AudioParams. */
export function clampGain(value: number, max = 1, fallback = 0): number {
 return Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
}
/** Same logarithmic control travel everywhere, with an exact silence endpoint. */
export function faderToGain(position: number, max = 1): number {
 const p = clampGain(position);
 return p === 0 ? 0 : max * 10 ** ((p - 1) * 60 / 20);
}
/** Inverse of the common 60 dB fader taper. Stored values remain amplitudes. */
export function gainToFader(gain: number, max = 1): number {
 return gain <= 0 || !Number.isFinite(gain) ? 0 : Number(clampGain(1 + 20 * Math.log10(gain / max) / 60).toFixed(14));
}
/** Readout in amplitude dB; 0 dB always means unity, not a page-specific default. */
export function gainLabel(gain: number): string {
 if (!(gain > 0) || !Number.isFinite(gain)) return 'Muted';
 const db = 20 * Math.log10(gain);
 return `${db > 0.05 ? '+' : ''}${Math.abs(db) < .05 ? '0.0' : db.toFixed(1)} dB`;
}
