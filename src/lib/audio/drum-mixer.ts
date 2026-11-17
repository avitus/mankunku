import type { Sampler, Scheduler } from 'smplr';
import { DRUM_ARTICULATIONS, DRUM_FAMILY_BY_VOICE, type DrumBufferName } from './sample-maps';
import type { DrumVoice } from './backing-styles';
import { BACKING_BASE_TRIMS, type BackingMixLevels, type DrumFamily } from './backing-mix';
import { SAMPLE_OPTIONS, SAMPLE_CHANNEL_REFERENCE, BACKING_INPUT_REFERENCE, BACKING_OUTPUT_REFERENCE, MIXER_DEFAULTS } from './mixer-policy';

export const DRUM_VOICES = Object.keys(DRUM_ARTICULATIONS) as DrumVoice[];
/** Fixed sample calibration; user voice levels are linear amplitude multipliers. */
export function drumCalibration(voice: DrumVoice): number {
 return SAMPLE_CHANNEL_REFERENCE * BACKING_BASE_TRIMS[voice] ** 2;
}
/** Shared live/offline voice channels retain layers while permitting actual gain faders. */
export async function createDrumMixer(context: BaseAudioContext, Instrument: typeof Sampler,
 buffers: Partial<Record<DrumBufferName, AudioBuffer>>, destinations: Record<DrumFamily, AudioNode>,
 scheduler: () => Scheduler, countDestination?: AudioNode) {
 const samplers = {} as Record<DrumVoice, Sampler>;
 const gains = {} as Record<DrumVoice, GainNode>;
 let countoff: Sampler | undefined;
 let countGain: GainNode | undefined;
 /** Release all voice channels, including the independent count-off. */
 const dispose = () => {
  for (const player of Object.values(samplers)) player.disconnect();
  countoff?.disconnect();
  for (const gain of Object.values(gains)) gain.disconnect();
  countGain?.disconnect();
 };
 const options = { ...SAMPLE_OPTIONS, detune: 0, decayTime: .3, lpfCutoffHz: 20000 };
 try {
  for (const voice of DRUM_VOICES) {
   const gain=context.createGain(); gains[voice]=gain;
   gain.gain.value=drumCalibration(voice); gain.connect(destinations[DRUM_FAMILY_BY_VOICE[voice]]);
   const voiceBuffers=Object.fromEntries(DRUM_ARTICULATIONS[voice].flatMap(({buffer}) => buffers[buffer] ? [[buffer,buffers[buffer]!]] : []));
   samplers[voice]=new Instrument(context,{ ...options, buffers: voiceBuffers, destination:gain, scheduler:scheduler() });
  }
  if (countDestination) {
   countGain=context.createGain();
   // The reference cross-stick heard at tune defaults, now owned by Click.
   countGain.gain.value=drumCalibration('crossstick') * BACKING_BASE_TRIMS.drums * BACKING_INPUT_REFERENCE * BACKING_OUTPUT_REFERENCE / MIXER_DEFAULTS.click;
   countGain.connect(countDestination);
   countoff=new Instrument(context,{ ...options, buffers:buffers.crossstick ? { crossstick:buffers.crossstick } : {}, destination:countGain, scheduler:scheduler() });
  }
  await Promise.all([...Object.values(samplers), ...(countoff ? [countoff] : [])].map(s=>s.load));
  return { samplers, countoff, dispose,
  /** Apply amplitude faders without changing articulation velocity. */
  setMix(mix: BackingMixLevels) {
   for (const voice of DRUM_VOICES) {
    const param = gains[voice].gain;
    const previous = param.value;
    param.cancelScheduledValues(0);
    param.value = previous;
    const value = drumCalibration(voice) * mix[voice];
    if (value === 0) param.value = 0;
    else param.setTargetAtTime(value,context.currentTime,.005);
   }
  } };
 } catch(error) { dispose(); throw error; }
}
