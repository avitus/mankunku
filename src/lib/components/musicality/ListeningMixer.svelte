<script lang="ts">
 import type { BackingMixLevels } from '$lib/audio/backing-mix';
 import type { BackingSignalSnapshot } from '$lib/audio/backing-signal-monitor';
 let { mix, onchange, disabled = false, dark = false, compact = false, signal, playing = false, elapsedBeats = 0, keyboardLabel = 'Piano' }: {
  mix: BackingMixLevels; onchange: (mix: BackingMixLevels) => void; disabled?: boolean; dark?: boolean; compact?: boolean;
  signal?: BackingSignalSnapshot | null; playing?: boolean; elapsedBeats?: number; keyboardLabel?: 'Piano' | 'Organ';
 } = $props();
 const instruments = $derived([{ key: 'bass', label: 'Bass' }, { key: 'comp', label: keyboardLabel }, { key: 'drums', label: 'Drums' }] as const);
 let remembered = $state({ bass: 1, comp: 1, drums: 1 });
 function mute(key: 'bass' | 'comp' | 'drums') {
  if (mix[key] > 0) { remembered[key] = mix[key]; onchange({ ...mix, [key]: 0 }); }
  else onchange({ ...mix, [key]: remembered[key] });
 }
</script>
<section class="mixer" class:dark aria-label="Listening mix" data-testid="listening-mixer">
 <div class="heading"><h3>Listening mix</h3><span>100% = normal level</span></div>
 <div class="channels">{#each instruments as instrument}
  {@const level=signal?.[instrument.key]}
  {@const db=playing && mix[instrument.key]>0 && level?.peak ? Math.max(-60,Math.min(0,20*Math.log10(level.peak))) : -60}
  <div class="channel" class:muted={mix[instrument.key] === 0}>
   <label for={`mix-${instrument.key}`}>{instrument.label}</label>
   <div class="fader-pair"><div class="fader"><span class="unity" aria-hidden="true"></span><input id={`mix-${instrument.key}`} aria-label={`${instrument.label} volume`} aria-orientation="vertical" type="range" min="0" max="3" step="0.05" value={mix[instrument.key]} {disabled}
    oninput={event => onchange({ ...mix, [instrument.key]: Number(event.currentTarget.value) })} />
   </div>
   <div class="signal-meter" role="meter" aria-label={`${instrument.label} audio signal`} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={db} aria-valuetext={playing && !level ? 'Signal unavailable' : `${Math.round(db)} dBFS`} title="Sampled instrument audio before master volume and your audio device">
    <span class="meter-cover" style:height={`${-db/60*100}%`}></span><span class="meter-segments"></span>
   </div></div>
   <output for={`mix-${instrument.key}`}>{Math.round(mix[instrument.key] * 100)}%</output>
   <button type="button" aria-label={`Mute ${instrument.label}`} aria-pressed={mix[instrument.key] === 0} {disabled} onclick={() => mute(instrument.key)}>{mix[instrument.key] === 0 ? 'Muted' : 'Mute'}</button>
   <span class="signal-status">{#if signal}<span data-testid={`signal-${instrument.key==='comp'?'piano':instrument.key}`}>{mix[instrument.key]===0?'Muted':!level?'Signal unavailable':level.peakSoFar>0.00001?'Signal observed':elapsedBeats<4?'Checking signal…':'No signal observed'}</span>{/if}</span>
  </div>
 {/each}</div>
 {#if !compact}<p>Hear each part clearly. The band keeps playing; only your listening balance changes.</p>{/if}
</section>
<style>
 .mixer{--ink:var(--color-text);--subtle:var(--color-text-secondary);--line:var(--color-bg-tertiary);--accent:var(--color-brass);padding:1rem 0;border-block:1px solid var(--line);color:var(--ink);margin-bottom:1.25rem}
 .dark{--ink:#dbe0e5;--subtle:#9aaabc;--line:#425267;--accent:#d5ad6c}
 .heading{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.65rem}.heading h3{margin:0;font-size:.7rem;font-weight:500}.heading span{font-size:.55rem;color:var(--subtle)}
 .channels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;padding:.4rem 0}
 .channel{display:flex;flex-direction:column;align-items:center;gap:.55rem;font-size:.68rem;border-right:1px solid color-mix(in srgb,var(--line) 45%,transparent)}.channel:last-child{border-right:0}
 .channel label{font-weight:500;letter-spacing:.025em}.fader{position:relative;height:118px;width:44px;display:flex;justify-content:center}
 .fader-pair{display:flex;align-items:center;gap:5px}.signal-meter{position:relative;width:8px;height:118px;overflow:hidden;border-radius:2px;background:linear-gradient(to top,#65af87 0%,#65af87 65%,#d5ad6c 85%,#ce725f 100%);box-shadow:0 0 0 1px var(--line)}
 .meter-cover{position:absolute;inset:0 0 auto;background:var(--color-bg-secondary,#182433)}.dark .meter-cover{background:#182433}.meter-segments{position:absolute;inset:0;background:repeating-linear-gradient(to top,transparent 0 4px,#101b2a88 4px 6px);pointer-events:none}
 .signal-status{min-height:1.5rem;text-align:center;font-size:.52rem;line-height:1.35;color:var(--subtle)}
 .unity{position:absolute;bottom:calc(33.333% + 3px);width:40px;height:1px;background:var(--subtle);opacity:.45;pointer-events:none}
 input{writing-mode:vertical-lr;direction:rtl;width:28px;height:118px;margin:0;accent-color:var(--accent);cursor:pointer;position:relative;z-index:1}output{font-size:.65rem;font-variant-numeric:tabular-nums;color:var(--subtle);min-width:3rem;text-align:center}
 button{border:1px solid var(--line);padding:.45rem .4rem;min-width:3.4rem;border-radius:3px;color:var(--subtle);font-size:.6rem;cursor:pointer}button[aria-pressed=true]{background:var(--accent);color:#172435;border-color:var(--accent)}
 input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button:disabled,input:disabled{opacity:.5;cursor:default}.muted label{color:var(--subtle)}
 p{font-size:.6rem;line-height:1.6;margin:.65rem 0 0;color:var(--subtle)}
</style>
