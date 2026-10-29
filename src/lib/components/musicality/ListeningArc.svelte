<script lang="ts">
 import type { PerformanceForm } from '$lib/types/performance-form';
 import { buildListeningArc } from '$lib/musicality/listening-arc';

 let { form, orchestration, barIndex = null, reviewing = false }: {
  form: PerformanceForm;
  orchestration: 'original' | 'coordinated';
  barIndex?: number | null;
  reviewing?: boolean;
 } = $props();
 const arc = $derived(buildListeningArc(form, orchestration));
 const selected = $derived(barIndex !== null && Number.isInteger(barIndex) && barIndex >= 0 && barIndex < arc.totalBars ? barIndex : null);
 const currentPass = $derived(selected === null ? null : arc.passes.find(pass => selected >= pass.startBar && selected < pass.endBarExclusive));
 const x = (bar: number) => (bar + .5) / arc.totalBars * 1000;
 const y = (energy: number) => 74 - energy * 64;
 const curve = $derived(arc.points.map(point => `${x(point.barIndex).toFixed(2)},${y(point.targetEnergy).toFixed(2)}`).join(' '));
 const highlighted = $derived(selected === null ? '' : arc.points.slice(0, selected + 1).map(point => `${x(point.barIndex).toFixed(2)},${y(point.targetEnergy).toFixed(2)}`).join(' '));
 const markerY = $derived(selected === null || !arc.points[selected] ? 42 : y(arc.points[selected].targetEnergy));
 const position = $derived(selected === null ? 'Whole tune' : `${reviewing ? 'Review · Bar' : 'Bar'} ${selected + 1} of ${arc.totalBars}`);
 const peak = $derived(arc.points.reduce<typeof arc.points[number] | null>((highest, point) => !highest || point.targetEnergy > highest.targetEnergy ? point : highest, null));
 const energyDescription = $derived(peak ? `Nominal planned energy: starts at ${Math.round(arc.points[0].targetEnergy * 100)} percent, peaks at ${Math.round(peak.targetEnergy * 100)} percent in ${arc.passes.find(pass => peak.barIndex >= pass.startBar && peak.barIndex < pass.endBarExclusive)?.label}, bar ${peak.barIndex + 1}, and ends at ${Math.round(arc.points[arc.points.length - 1].targetEnergy * 100)} percent. This describes structural intention, not measured loudness.` : '');
 const description = $derived(arc.passes.map(pass => `${pass.label}, ${pass.endBarExclusive - pass.startBar} bars`).join('; '));
</script>

{#if arc.totalBars > 0}
 <figure class="listening-arc" data-testid="listening-arc" data-bar-index={selected ?? ''} aria-label="Overall performance arc">
  <figcaption><span>{orchestration === 'coordinated' ? 'Planned energy' : 'Tune form'}</span><span data-testid="listening-arc-position">{position}</span></figcaption>
  {#if energyDescription}<span class="sr-only" data-testid="listening-arc-description">{energyDescription}</span>{/if}
  <div class="curve">
   <svg viewBox="0 0 1000 84" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="1000" y1="76" y2="76" class="baseline" />
    {#each arc.passes.slice(1) as pass}<line x1={pass.startBar / arc.totalBars * 1000} x2={pass.startBar / arc.totalBars * 1000} y1="6" y2="76" class="boundary" />{/each}
    {#if curve}<polyline points={curve} class="planned" data-testid="listening-arc-curve" />{/if}
    {#if highlighted}<polyline points={highlighted} class="highlighted" />{/if}
    {#if selected !== null}
     <line x1={x(selected)} x2={x(selected)} y1="6" y2="76" class="cursor" />
    {/if}
   </svg>
   {#if selected !== null}<span class="marker" data-testid="listening-arc-marker" style:left={`${x(selected) / 10}%`} style:top={`${markerY / 84 * 100}%`}></span>{/if}
  </div>
  <div class="passes" aria-label={description}>
   {#each arc.passes as pass}
    <span class:current={currentPass?.index === pass.index} style:flex={pass.endBarExclusive - pass.startBar} data-testid="listening-arc-pass" aria-current={currentPass?.index === pass.index ? 'step' : undefined}>{pass.label}</span>
   {/each}
  </div>
  <p>{orchestration === 'coordinated' ? 'Structural intention, not measured loudness.' : 'Original arrangement · no shared energy plan.'}</p>
 </figure>
{/if}

<style>
 .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
 .listening-arc{margin:1rem 0 .75rem;padding:.8rem 0 .6rem;border-block:1px solid #42526766;color:#9aafc4}
 figcaption{display:flex;justify-content:space-between;gap:.5rem;font-size:.6rem;letter-spacing:.06em}
 figcaption span:first-child{text-transform:uppercase;color:#c7b181}
 figcaption span:last-child{font-variant-numeric:tabular-nums;letter-spacing:0}
 .curve{position:relative;height:78px;margin-top:.35rem}
 svg{display:block;width:100%;height:100%;overflow:visible}
 line,polyline{vector-effect:non-scaling-stroke;fill:none}
 .baseline{stroke:#46576b;stroke-width:.7}
 .boundary{stroke:#46576b88;stroke-width:.6;stroke-dasharray:2 5}
 .planned{stroke:#9a8660;stroke-width:1.7;stroke-linejoin:round}
 .highlighted{stroke:#d8b574;stroke-width:2;stroke-linejoin:round}
 .cursor{stroke:#e9d4ac;stroke-width:.7;stroke-dasharray:2 3}
 .marker{position:absolute;width:7px;height:7px;border-radius:50%;background:#f4dfb5;border:2px solid #182536;box-shadow:0 0 0 1px #c5a873;transform:translate(-50%,-50%);pointer-events:none}
 .passes{display:flex;gap:0;font-size:.57rem;text-align:center;line-height:1.5}
 .passes span{min-width:0;padding:.25rem .1rem;color:#8195aa}
 .passes .current{color:#f0d8a6}
 p{margin:.55rem 0 0;font-size:.55rem;color:#8298ae;line-height:1.5}
</style>
