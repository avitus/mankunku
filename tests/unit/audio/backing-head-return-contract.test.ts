import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { generateBacking, resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildPerformanceForm } from '$lib/audio/performance-form';
import { buildListeningTuneSession, assessListeningTune } from '$lib/musicality/listening-tunes';
import { MANKUNKU_BLUES } from '$lib/data/tunes';
import { LOCAL_LISTENING_AABA } from '../../fixtures/musicality-local-aaba';
import type { BackingStyle } from '$lib/types/instruments';

const styles: BackingStyle[] = ['swing', 'straight', 'bossa-nova', 'ballad'];
function material(tune: 'blues' | 'aaba') {
	if (tune === 'blues') return buildListeningTuneSession({ tuneId: MANKUNKU_BLUES.id, soloChoruses: 2 });
	const admitted = assessListeningTune(LOCAL_LISTENING_AABA, { soloChoruses: 2 });
	if (!admitted.ok) throw new Error(admitted.reason);
	return admitted.session;
}
function inputs(tune: 'blues' | 'aaba', style: BackingStyle) {
	const session = material(tune); const phrase = session.phrase;
	const tempo = tune === 'aaba' ? 100 : style === 'ballad' ? 80 : 140;
	const params = { phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4,
		swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
		sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {} };
	return { session, phrase, params };
}
function run(tune: 'blues' | 'aaba', style: BackingStyle, variant = 'explicit') {
	const { session, phrase, params } = inputs(tune, style);
	let form = params.performanceForm;
	if (variant === 'head-only') form = buildPerformanceForm({ totalBars: session.bars.length, sectionMap: phrase.sectionMap!, choruses: [{ role: 'head', startBar: 0, endBarExclusive: session.bars.length }] });
	if (variant === 'short') form = buildPerformanceForm({ totalBars: session.bars.length, sectionMap: phrase.sectionMap!, choruses: [{ role: 'solo', startBar: 0, endBarExclusive: session.bars.length - 6 }, { role: 'head', startBar: session.bars.length - 6, endBarExclusive: session.bars.length }] });
	const score = createRollingBacking(phrase.harmony!, BACKING_STYLES[style], { ...params, performanceForm: variant === 'implicit' ? undefined : form },
		variant === 'default' ? {} : { returningMelodySpace: variant !== 'disabled' });
	let checkpoint: RollingBackingCheckpoint | undefined;
	const windows = Array.from({ length: score.totalBars }, () => { const bar = advanceRollingBacking(score, checkpoint); checkpoint = bar.checkpoint; return bar; });
	return { score, windows, session };
}
const hash = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');

// Captured from the unchanged engine before implementing returning-head space.
// Full matched event evidence: musicality-2026-10-29/head-return-space/*-before.json.
const before = {
  "blues:swing": {
    "headStart": 40,
    "gapAttacks": [
      1,
      0
    ],
    "afterAttacks": [
      0,
      1,
      1,
      0,
      1,
      1,
      1,
      0,
      1
    ],
    "prefix": "c49f01cf4736dfa81a615f74ec12e8bcd71b6158fc434ff5cefece9bdaf4ec53",
    "bass": "da66ff8860e78a993a59eea85d5399b18e2fa8d376e70456917372c7e6f2adb0",
    "drumPulse": "055302798c20cf8a247e82f4239709715d2d25f226de3afb6fa08c89054dc963",
    "fixed": "4412332084722eb51c77af4eee4cd3a5e78b377813058fe862ae4334751166fe",
    "original": "312fcf6276bc06ba350749c6faca4f6f07e6b2b6620dc35f71fd84469a618404",
    "implicit": "3cea965916a618f52d975164764c404ab98d969c04849bbc863b456faa6fdb8c",
    "head-only": "be8bb23f68d78df9bf1cf29f95f97fe6d653bec435f756b82c48acebfdbf15c6",
    "short": "5dc200fa04325c9f4f9e9e55cd7edcd8ebac62a85d90fcc92bdd68b0d4951560"
  },
  "blues:straight": {
    "headStart": 40,
    "gapAttacks": [
      1,
      0
    ],
    "afterAttacks": [
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      0,
      1
    ],
    "prefix": "01437f5a4dee609bc425f6f02aed51e9b130c2a87115998ed5cccd245351492f",
    "bass": "57d746d0b4cbd8cc243ac780313de21d3a7bf639030bb585a2d4277af6e754a2",
    "drumPulse": "9512fd1dc1f3e7cb38a51e7b42697e0e450e70e8e7e3e1d42c9742557e822e3f",
    "fixed": "241b7688872df55f275e6db1c19551a14bf26fb2ed6ba0faf37c23d711653a88",
    "original": "578e9a8cbfa1e240f81bcc58db82e2f1de09d05a9c5ebf6b01c5f0cf4e96853b",
    "implicit": "cab60b0e9a3b79426e0282310629ff23412dded0a939483a082cd9a38701d9d2",
    "head-only": "221ae965289a45d0305b7d5961c0f63c4f619bb79ad0f15d6d2b7577ffb2487f",
    "short": "2ab72b2798e6f316fd0a3385ebb740051724707b427b07a4a0f1b8da07ac16a9"
  },
  "blues:bossa-nova": {
    "headStart": 40,
    "gapAttacks": [
      1,
      0
    ],
    "afterAttacks": [
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1
    ],
    "prefix": "6cc029cd582e2ee87d217c2b954f880be4f345e254fce593f5f1de054f763f91",
    "bass": "ee0594dcbc138fd057fde9bba3ac97d9496472286d941a4d38b8f4570ee85ddb",
    "drumPulse": "31695e03671c3e891f1eab877aa484efd1aa5ce0f520ad6b34825cf9a935b08e",
    "fixed": "1ba82a12dd8cf1e57c93926c3c9fb8ec5edb773eed4cc347f4fc7119bddab70b",
    "original": "efc5e9e6b67e0fd8361ab95582f20dfd69ecd7d6efd09ac329131a834918166b",
    "implicit": "26a83f7ade759a1c813845504b8ceffd6c9b8dd5bf8dce445353bebf0c43dfc8",
    "head-only": "a5e92bc9493493679d778662a1af80b52a36ba99d524d82c530881e49aec828b",
    "short": "ba7dc56d333a91a0ed7e5457dcb030cb53b416ea197d01c840d85b7d8636a992"
  },
  "blues:ballad": {
    "headStart": 40,
    "gapAttacks": [
      1,
      1
    ],
    "afterAttacks": [
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      1,
      0
    ],
    "prefix": "cae6e63049c7be5e84ed439564b47c403455747ff3dd67381d012166f4a01fae",
    "bass": "4f89b5b4746b98faa99c0415f9904965d0e0ba22c0c0e74554a7d2cfd8945fc1",
    "drumPulse": "a60e4371eb3a48dd3867ad839cfa19984342eb2f1f2ee97be7afdc05c1a28756",
    "fixed": "eb5f55bc5992c5b41d3f1e3b878d50615a9c02b50f57ff637b60baa8f9c6bf26",
    "original": "545928bd7fe820fa1a073546a35d9971e9e08c8d113fa3b04508fa8c6a9988a5",
    "implicit": "f4feda689874bb764f459cc17322f283dc00d981282ac2201ccb6700e950b770",
    "head-only": "f3fe4df29dbf93f378eb95bac6fe65142f15335694098f199e55184ebddab66f",
    "short": "08614d565462e9ce5911b65bb00c99e0792f59d4c59e591aff79110b4d274132"
  },
  "aaba:swing": {
    "headStart": 96,
    "gapAttacks": [
      0,
      1
    ],
    "afterAttacks": [
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      0,
      1,
      0,
      0,
      1,
      0,
      1,
      1,
      1,
      0,
      0
    ],
    "prefix": "9e388fa15afa25da819ea0a1aee9a82f429d54eb5b40226118d6a8be305739c7",
    "bass": "8cb104d749d760af87965ddee2ddac670dc36e60a541bc30a95b1a2c06fe9269",
    "drumPulse": "deb0cc6f4d429baae99855d4e1722db32d8a453237de091af43b9cb9c2442c45",
    "fixed": "75e24b38a6c306f4c56be12e2242d2c7c9409a7e6351ace7440a8728f1109c04",
    "original": "2ee518415507fc1895d84c0ac3395a2593c034cf39a1d751e28f2fce7a72625d",
    "implicit": "bbf3ed991d93934f8873de6ba657487e2afdc3a658c454a1d8222f6ea5a28f2c",
    "head-only": "09580d12a7e8457a8665966dfa2e1b2aab818c69b051dfe8221dbb463df32531",
    "short": "f2fd8664f1bb55603526c67501906f8a819f62bc8e59aaf80546744a2397b6a9"
  },
  "aaba:straight": {
    "headStart": 96,
    "gapAttacks": [
      0,
      1
    ],
    "afterAttacks": [
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      0,
      1,
      0,
      0,
      1,
      0,
      1,
      1,
      1,
      0,
      0
    ],
    "prefix": "242eab6b94ce9163d791c334f714dd378f3704d8fae0329b1e60f9755846825e",
    "bass": "0d50e8a5fbfbb70513a5c86f5ede678538085c0ab15dc11355900d2bf7cbdb06",
    "drumPulse": "7efbd641d224679dfad081672b45a68d264f7b93492e14115ad5ec5edf2b259a",
    "fixed": "4b737ed1f823117234d5ef372a45c7ab6c085c741bb2743f9e287af815f2d65f",
    "original": "8ffd329835a382c486e55055326ba373dcf74982c3bc47f1cb4e460be09dc0f5",
    "implicit": "7930878d3e24ca47af38ab87063d6048be503ba7f015a3758145a81c59d46a2c",
    "head-only": "5cb3fc0515af774cd95bd999bd4c6904b3ba7437609daf4e3423d67b194129b3",
    "short": "3f7d702152e4ea68007d141207e1561dc0b0a71d59803047a845389351897d00"
  },
  "aaba:bossa-nova": {
    "headStart": 96,
    "gapAttacks": [
      1,
      1
    ],
    "afterAttacks": [
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0
    ],
    "prefix": "61798bbf52954196d17830ccd6b2faf8aab45a6e61909586021ba393e04634bc",
    "bass": "66a6959d9117eb3b6c102cf2ea5dc99b8c5430743fa4e73d9061e2ec8177d39c",
    "drumPulse": "bb768f3b3031c1029f6291c6079a36a0d8ecff35367369f7c483ea002e76ead7",
    "fixed": "59199d91cd6be6c98fd02a02272122c0dc26dd29643e7fa83248dd9f52460588",
    "original": "824d6544d02c1ccd1f6953346d2eefbb9b7f65127e7178e20552dc9e355f0eb1",
    "implicit": "106df075afea9829de65873bfb88df659f0eb0e86c3236ae10d0ea1c52c0532a",
    "head-only": "9574f45ea5296d412d8acb07d4554b1c930049c5dc0ec78a2bff0fa08af728a5",
    "short": "2831332822f1341f1c193c5f6d243c7f0a18f2adfb720c59147c92574fa2fb70"
  },
  "aaba:ballad": {
    "headStart": 96,
    "gapAttacks": [
      1,
      1
    ],
    "afterAttacks": [
      0,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0
    ],
    "prefix": "fa31c19cf065f4629506bfc0c6a576946d1e44c88b1deee804a55a910a9fa92e",
    "bass": "9cf45d06f9c5fd973eba6a3446e47264e141d8c9332bdce424e9f6840f7c7382",
    "drumPulse": "76830cbb7200f8260d0d905adce7d00e984d986be5f4a76dd7c536e81237d2f7",
    "fixed": "fe984f3f18e7bc199efc7242e857596100b18f31ef544a8603117bd65e3acfce",
    "original": "fdd13183b9832cbccccd14e2621a55afcf42c9c95a498fd1925abd4ff49f6e4f",
    "implicit": "1215f318519660cba6e22aac1d542d3f930a34c95f7f2d6e175aae309d06a7b8",
    "head-only": "f084c268c5321d246f121c7be7f3602381d4e4071fd385b543b3b3d7d0a79fad",
    "short": "7834636e4055759cac461d3282a130f026481954e6f556c47c8430ae256c5c72"
  }
} as const;


// Exact full musical evidence and checkpoint identities from the pre-change artifact.
const defaultEvidence = {
  "blues:swing": "dd938d5ede7bc86f820bd26ad40cc094541f70bc09f5a6dfef8920cc4cdb9cf7",
  "blues:straight": "2741ec53d17efcb6debfa14adbde86cf8dc1cc49eee78540e254ccf807974622",
  "blues:bossa-nova": "353fec18f030b6e96720cb572affec1a9773bd141aeabef6eb2acfa99195aa4e",
  "blues:ballad": "315c7c221877ca51c71aa084b716a369fe1e695d1215e639887684202a1a3fc3",
  "aaba:swing": "5fd5165198bbca235fe0d9d89fb0b3e117f5200340817e1564734eac64664b4e",
  "aaba:straight": "b60e5f33bb7b54583964a293e0111bcc52a4e175c2bbec0e788985f896458f6e",
  "aaba:bossa-nova": "86ee0d8d6f95cdd770d45a8426f728c25efec6cd0bef63d21425a26fffbb7395",
  "aaba:ballad": "dc21014ca882fad5e92b47773a60b99557ee546dcd6a8aba0baf98f89400bd5a"
} as const;

describe('returning-head breath in complete natural performances', () => {
 for (const tune of ['blues', 'aaba'] as const) for (const style of styles) {
  const baseline = before[`${tune}:${style}`];
  it(`${tune} ${style}: leaves two bars for the melody after the unchanged arrival, then resumes native comping`, () => {
   const { windows, score } = run(tune, style);
   const head = baseline.headStart;
   expect(score.totalBars).toBe(tune === 'blues' ? 52 : 128);
   expect(baseline.gapAttacks.some(count => count > 0)).toBe(true);
   expect(hash(windows.slice(0, head + 1).map(({ bassEvents, compEvents, drumEvents }) => ({ bassEvents, compEvents, drumEvents })))).toBe(baseline.prefix);
   expect(windows.slice(head + 1, head + 3).flatMap(bar => bar.compEvents)).toEqual([]);
   for (const offset of [1, 2]) {
    expect(score.bars[head + offset]).toMatchObject({ returningMelodySpace: { version: 1, headStartBar: head, offset } });
   }
   expect(score.bars[head]).not.toHaveProperty('returningMelodySpace');
   expect(score.bars[head + 3]).not.toHaveProperty('returningMelodySpace');
   expect(windows.slice(head + 3).some(bar => bar.compEvents.length > 0)).toBe(true);
   if (tune === 'blues' && style !== 'ballad') expect(windows[head + 2].ensemblePlan.bars[0].piano.silenceReason).toBe('phrase_resolution');
   expect(hash(windows.map(bar => bar.bassEvents))).toBe(baseline.bass);
   expect(hash(windows.map(bar => bar.drumEvents.filter(event => event.role !== 'commentary')))).toBe(baseline.drumPulse);
   // No chord from the arrival or either side of the gap may ring into a later bar.
   for (const bar of windows) for (const event of bar.compEvents) {
    const release = Number.parseInt(event.time) + event.duration * score.tempo / 60 * score.ppq;
    expect(release).toBeLessThanOrEqual(bar.committedThroughTick + 1e-8);
   }
  });

  it(`${tune} ${style}: preserves fixed, Original, implicit, head-only and short-head output exactly`, () => {
   const { phrase, params } = inputs(tune, style);
   expect(hash(generateBacking(phrase.harmony!, BACKING_STYLES[style], params))).toBe(baseline.fixed);
   expect(hash(generateBacking(phrase.harmony!, BACKING_STYLES[style], { ...params, ensemble: undefined }))).toBe(baseline.original);
   for (const variant of ['implicit', 'head-only', 'short'] as const) expect(hash(run(tune, style, variant).windows)).toBe(baseline[variant]);
   for (const variant of ['default', 'disabled']) {
    const { score, windows } = run(tune, style, variant);
    expect(score).not.toHaveProperty('returningMelodySpaceVersion');
    const evidence = windows.map(bar => ({ bar: bar.fromBar, bassEvents: bar.bassEvents, compEvents: bar.compEvents, drumEvents: bar.drumEvents,
     plan: bar.ensemblePlan, development: bar.ensembleDevelopment, timing: bar.ensembleTiming, checkpointId: bar.checkpoint.checkpointId }));
    expect(hash(evidence)).toBe(defaultEvidence[`${tune}:${style}`]);
   }
  });

  it(`${tune} ${style}: resumes a saved checkpoint inside the breath without rewriting committed evidence`, () => {
   const { score, windows } = run(tune, style);
   const firstGap = windows[baseline.headStart + 1];
   const committed = JSON.stringify(firstGap);
   const checkpoint = JSON.parse(JSON.stringify(firstGap.checkpoint));
   const resumed = advanceRollingBacking(score, checkpoint);
   expect(resumed).toEqual(windows[baseline.headStart + 2]);
   expect(resumed.compEvents).toEqual([]);
   const futureBar = baseline.headStart + 4;
   const withFuture = advanceRollingBacking(score, checkpoint, [{ barIndex: futureBar, observedAtBar: futureBar - 1,
    source: 'microphone', confidence: .95, noteDensity: 1, restBeats: 0 }]);
   expect(withFuture).toEqual(resumed);
   expect(JSON.stringify(firstGap)).toBe(committed);
   expect(checkpoint).toEqual(firstGap.checkpoint);
   expect(Object.isFrozen(checkpoint)).toBe(false);
  });
 }
});
