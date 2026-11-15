<script lang="ts">
 import { afterNavigate } from '$app/navigation';
 import SeoHead from '$lib/components/seo/SeoHead.svelte';
 import MusicalityLedger from '$lib/components/musicality/MusicalityLedger.svelte';
 import ListeningStudio from '$lib/components/musicality/ListeningStudio.svelte';
 import BlindListeningReview from '$lib/components/musicality/BlindListeningReview.svelte';
 import type { PageData } from './$types';
 let { data }: { data: PageData } = $props();
 let tab = $state<'listen' | 'specification'>('listen');
 let comparison = $state(false);
 function reveal(hash: string) {
  if(hash === '#original-spec' || data.requirements.some(entry => `#${entry.id}` === hash.toUpperCase())) tab = 'specification';
 }
 afterNavigate(({ to }) => { if(to) reveal(to.url.hash); });
</script>
<svelte:window onhashchange={(event) => reveal(new URL(event.newURL).hash)} />
<SeoHead title="Musicality — Mankunku" description="Listen to complete tunes and follow the bass, piano and drums. Explore the rhythm section’s living specification." />
<div class="musicality">
 {#if tab==='specification'}<h1>Musicality</h1>{/if}
 {#if tab === 'listen'}
  {#if comparison}<BlindListeningReview buildVersion={data.buildVersion} onexit={() => comparison = false} />{:else}<ListeningStudio buildVersion={data.buildVersion} oncompare={() => comparison = true} />{/if}
 {:else}<MusicalityLedger {data} />{/if}
 <nav class="tabs" aria-label="Musicality views">
  <button class:active={tab === 'listen'} aria-pressed={tab === 'listen'} onclick={() => { tab = 'listen'; comparison = false; }}>Listen</button>
  <button class:active={tab === 'specification'} aria-pressed={tab === 'specification'} onclick={() => tab = 'specification'}>Specification</button>
  <a href="/diagnostics/backing-mixer">Advanced listening lab ↗</a><span>In development · Listening review pending</span>
 </nav>
</div>
<style>
 .musicality{--color-bg:#111b2b;--color-bg-secondary:#1d293a;--color-bg-tertiary:#46566b;--color-text:#f3eee5;--color-text-secondary:#9aaabc;--color-brass:#d5ad6c;max-width:1500px;margin:0 auto;padding:1.5rem 2.5rem 3rem;color:#f3eee5;background:#111b2b;min-height:calc(100vh - 4rem)}
 h1{font:400 2rem var(--font-display);margin:1rem 0}
 .tabs{display:flex;flex-wrap:wrap;gap:1.4rem;align-items:center;border-bottom:1px solid #46566b;margin-top:1.5rem}.tabs button{padding:.8rem 0;border-bottom:1px solid transparent;color:#9aaabc;font-size:.7rem;cursor:pointer}.tabs button.active{color:#d5ad6c;border-color:#d5ad6c}.tabs a{font-size:.65rem;color:#9aaabc}.tabs span{margin-left:auto;font-size:.55rem;color:#91a1b4}.tabs button:focus-visible{outline:2px solid #d5ad6c;outline-offset:3px}
 @media(max-width:800px){.musicality{padding:1.25rem 1rem 2rem}.tabs span{text-align:right;max-width:9rem;line-height:1.7}}
</style>
