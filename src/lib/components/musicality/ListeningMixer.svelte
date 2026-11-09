<script lang="ts">
 import type { BackingMixLevels } from '$lib/audio/backing-mix';
 let { mix, onchange, disabled = false, dark = false }: {
  mix: BackingMixLevels; onchange: (mix: BackingMixLevels) => void; disabled?: boolean; dark?: boolean;
 } = $props();
 const instruments = [{ key: 'bass', label: 'Bass' }, { key: 'comp', label: 'Piano' }, { key: 'drums', label: 'Drums' }] as const;
 let remembered = $state({ bass: 1, comp: 1, drums: 1 });
 function mute(key: 'bass' | 'comp' | 'drums') {
  if (mix[key] > 0) { remembered[key] = mix[key]; onchange({ ...mix, [key]: 0 }); }
  else onchange({ ...mix, [key]: remembered[key] });
 }
</script>
<section class="mixer" class:dark aria-label="Listening mix" data-testid="listening-mixer">
 <div class="heading"><h3>Listening mix</h3><span>100% = normal level</span></div>
 {#each instruments as instrument}
  <div class="channel" class:muted={mix[instrument.key] === 0}>
   <label for={`mix-${instrument.key}`}>{instrument.label}</label>
   <input id={`mix-${instrument.key}`} aria-label={`${instrument.label} volume`} type="range" min="0" max="3" step="0.05" value={mix[instrument.key]} {disabled}
    oninput={event => onchange({ ...mix, [instrument.key]: Number(event.currentTarget.value) })} />
   <output for={`mix-${instrument.key}`}>{Math.round(mix[instrument.key] * 100)}%</output>
   <button type="button" aria-label={`Mute ${instrument.label}`} aria-pressed={mix[instrument.key] === 0} {disabled} onclick={() => mute(instrument.key)}>{mix[instrument.key] === 0 ? 'Muted' : 'Mute'}</button>
  </div>
 {/each}
 <p>Hear each part clearly. The band keeps playing; only your listening balance changes.</p>
</section>
<style>
 .mixer{--ink:var(--color-text);--subtle:var(--color-text-secondary);--line:var(--color-bg-tertiary);--accent:var(--color-brass);padding:1rem 0;border-block:1px solid var(--line);color:var(--ink);margin-bottom:1.25rem}
 .dark{--ink:#dbe0e5;--subtle:#9aaabc;--line:#425267;--accent:#d5ad6c}
 .heading{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.65rem}.heading h3{margin:0;font-size:.7rem;font-weight:500}.heading span{font-size:.55rem;color:var(--subtle)}
 .channel{display:grid;grid-template-columns:2.6rem minmax(2rem,1fr) 2.5rem 3rem;align-items:center;gap:.5rem;min-height:38px;font-size:.68rem}
 input{width:100%;min-width:0;accent-color:var(--accent);cursor:pointer}output{text-align:right;font-size:.6rem;font-variant-numeric:tabular-nums;color:var(--subtle)}
 button{border:1px solid var(--line);padding:.35rem .15rem;border-radius:3px;color:var(--subtle);font-size:.6rem;cursor:pointer}button[aria-pressed=true]{background:var(--accent);color:#172435;border-color:var(--accent)}
 input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button:disabled,input:disabled{opacity:.5;cursor:default}.muted label{color:var(--subtle)}
 p{font-size:.6rem;line-height:1.6;margin:.65rem 0 0;color:var(--subtle)}
</style>
