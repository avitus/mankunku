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
 <header>
  <div class="eyebrow">Mankunku / The rhythm section</div>
  <div class="title-line"><h1>Musicality<span aria-hidden="true">.</span></h1><a href="/diagnostics/backing-mixer">Advanced listening lab ↗</a></div>
  <p>Listen to the whole tune. Follow the conversation.</p>
 </header>
 <nav class="tabs" aria-label="Musicality views">
  <button class:active={tab === 'listen'} aria-pressed={tab === 'listen'} onclick={() => { tab = 'listen'; comparison = false; }}>Listen</button>
  <button class:active={tab === 'specification'} aria-pressed={tab === 'specification'} onclick={() => tab = 'specification'}>Specification</button>
  <span>In development · Listening review pending</span>
 </nav>
 {#if tab === 'listen'}
  {#if comparison}<BlindListeningReview buildVersion={data.buildVersion} onexit={() => comparison = false} />{:else}<ListeningStudio buildVersion={data.buildVersion} oncompare={() => comparison = true} />{/if}
 {:else}<MusicalityLedger {data} />{/if}
</div>
<style>
 .musicality { padding: 1.5rem 0 3rem; }
 .eyebrow { font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--color-brass); }
 .title-line {display:flex;align-items:center;justify-content:space-between;gap:1rem}
 h1 {font-family:var(--font-display,Georgia,serif);font-weight:400;font-size:clamp(3.2rem,7vw,4.8rem);letter-spacing:-.05em;line-height:1.1;margin:.8rem 0 .7rem}
 h1 span{color:var(--color-brass)}
 header p{color:var(--color-text-secondary);font-size:1rem;margin-bottom:2rem}
 a{font-size:.75rem;color:var(--color-text-secondary)}
 .tabs{display:flex;align-items:center;gap:1.75rem;border-bottom:1px solid var(--color-bg-tertiary)}
 .tabs button{padding:1rem 0;border-bottom:2px solid transparent;color:var(--color-text-secondary);font-size:.85rem;cursor:pointer}
 .tabs button.active{color:var(--color-brass);border-color:var(--color-brass)}
 .tabs span{margin-left:auto;text-transform:uppercase;letter-spacing:.07em;font-size:.53rem;color:var(--color-text-secondary)}
 button:focus-visible,a:focus-visible{outline:2px solid var(--color-brass);outline-offset:4px}
 @media(max-width:640px){.tabs span{max-width:11rem;text-align:right;line-height:1.6}.title-line a{max-width:6rem;line-height:1.6}.tabs{gap:1.25rem}}
</style>
