import { assertBossaContourCompatibility, type BossaContourPerformance } from './bossa-contour-assertions';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';

const tune = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'F#', soloChoruses: 2 });
const params = { phraseId: tune.phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
	performanceForm: tune.phrase.performanceForm, sectionMap: tune.phrase.sectionMap, ensemble: {} };

/** The ordinary F# picker seed has an existing setup on bar3 and arrival on bar4. */
describe('real-chart shared piano arrival', () => {
	it.each(['swing', 'straight'] as const)('%s fixed playback catches the first existing Blues arrival exactly once', id => {
		const style = BACKING_STYLES[id];
		const generated = generateBacking(tune.phrase.harmony, style, { ...params, swing: style.defaultSwing });
		const arrival = generated.ensemblePlan!.bars[4].coordinatedAccent!;
		expect(arrival.id).toBe('arrival:4');
		expect(generated.ensemblePlan!.bars[3].setupFor).toEqual(arrival);
		const catches = generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 4);
		expect(catches).toHaveLength(1);
		expect(catches[0].absBeat).toBe(16);
		const bass = generated.bassEvents.find(event => event.absBeat === 16)!;
		const drums = generated.drumEvents.filter(event => event.absBeat === 16 && event.role === 'accent');
		expect(drums.length).toBeGreaterThan(0);
		expect(catches[0].time).toBe(bass.time);
		for (const hit of drums) expect(hit.time).toBe(bass.time);
		expect(generated.ensemblePlan!.bars[4].piano).toMatchObject({ maxAttacks: 1, arrival: { action: 'catch', accentId: arrival.id } });
	});

	it.each(['swing', 'straight'] as const)('%s rolling playback catches the existing arrival without replaying ordinary comping', id => {
		const style = BACKING_STYLES[id];
		const score = createRollingBacking(tune.phrase.harmony, style, { ...params, swing: style.defaultSwing });
		let previous;
		for (let bar = 0; bar < 4; bar++) previous = advanceRollingBacking(score, previous?.checkpoint);
		const arrival = advanceRollingBacking(score, previous!.checkpoint);
		expect(previous!.ensemblePlan.bars[0].setupFor).toEqual(arrival.ensemblePlan.bars[0].coordinatedAccent);
		expect(arrival.compEvents).toHaveLength(1);
		expect(arrival.compEvents[0].absBeat).toBe(16);
		const tick = arrival.bassEvents.find(event => event.absBeat === 16)!.time;
		expect(arrival.compEvents[0].time).toBe(tick);
		const accents = arrival.drumEvents.filter(event => event.role === 'accent');
		expect(accents.length).toBeGreaterThan(0);
		expect(accents.every(event => event.time === tick)).toBe(true);
		expect(arrival.checkpoint.piano.voicing!.notes).toEqual(arrival.compEvents[0].notes);
	});
});

it.each(['swing', 'straight'] as const)('%s retains setup history, withholds only the current catch under dense evidence, and ignores future evidence', id => {
	const style = BACKING_STYLES[id];
	const definition = createRollingBacking(tune.phrase.harmony, style, { ...params, swing: style.defaultSwing });
	let setup;
	for (let bar = 0; bar < 4; bar++) setup = advanceRollingBacking(definition, setup?.checkpoint);
	const stored = JSON.stringify(setup);
	const committed = setup!.checkpoint;
	const caught = advanceRollingBacking(definition, committed);
	const future = advanceRollingBacking(definition, committed, [{ barIndex: 14, observedAtBar: 14,
		source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }]);
	expect(future).toEqual(caught);
	expect(advanceRollingBacking(definition, JSON.parse(JSON.stringify(committed)))).toEqual(caught);
	const dense = advanceRollingBacking(definition, committed, [{ barIndex: 4, observedAtBar: 4,
		source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }]);
	expect(dense.ensemblePlan.bars[0].piano).toMatchObject({ maxAttacks: 0,
		arrival: { action: 'withhold', reason: 'soloist_dense', accentId: 'arrival:4' } });
	expect(dense.compEvents).toEqual([]);
	expect(dense.checkpoint.piano.voicing).toEqual(committed.piano.voicing);
	expect(dense.ensemblePlan.bars[0].coordinatedAccent).toEqual(committed.ensemble.pendingArrival);
	expect(dense.bassEvents).toEqual(caught.bassEvents);
	expect(dense.drumEvents).toEqual(caught.drumEvents);
	expect(JSON.stringify(setup)).toBe(stored);
	const trace = caught.ensembleDevelopment.pianoVoicings!;
	expect(trace).toHaveLength(1);
	expect(trace[0]).toMatchObject({ arrivalId: 'arrival:4', time: caught.compEvents[0].time, notes: caught.compEvents[0].notes });
	// Neither a prior committed chord nor the new catch crosses an owned bar boundary.
	for (const event of setup!.compEvents)
		expect(parseInt(event.time) + event.duration * params.tempo / 60 * params.ppq).toBeLessThanOrEqual(parseInt(caught.compEvents[0].time) + 1e-8);
	for (const event of caught.compEvents)
		expect(parseInt(event.time) + event.duration * params.tempo / 60 * params.ppq).toBeLessThanOrEqual(5 * 768 + 1e-8);
});

// Event hashes captured from clean b3a2b6bc before this policy changed.
const unchanged = [
  {
    "style": "swing",
    "mode": "original",
    "engine": "fixed",
    "expected": {
      "bassEvents": "3085663d65722fb90f211641c5be5028128e6a54bfbf406b482c8ae0a8f39dd3",
      "compEvents": "f5905913a739a625dbc465a15f3cd4764a79617b8f813d698a43fc6e3157b6e3",
      "drumEvents": "c56adeaee45a27de4aee7aa96bc1801ce5c8de07cd0547c180bfacf547f55e9c"
    }
  },
  {
    "style": "swing",
    "mode": "coordinated-implicit",
    "engine": "fixed",
    "expected": {
      "bassEvents": "2180974ea30c38f00aed4b1603c0aaba4da24f1c160333938de7690e87d33ee5",
      "compEvents": "81914b9c1fc200bc44cda42a940bd7858d2c2971754b4ce874663f3a8f993cdb",
      "drumEvents": "18b4df34f940e0a4a6ce7360416c60d38a7169b6071a66f244fd31705ac56f65"
    }
  },
  {
    "style": "swing",
    "mode": "coordinated-implicit",
    "engine": "rolling",
    "expected": {
      "bassEvents": "c7f466cb6f5c7a67288cf50554e5b2e65a5d82fee92307e2234a845b6af7204c",
      "compEvents": "ba63273d3097f9686ada06aa95caeaf17d160d81888651c3aaeacddfaf054b8e",
      "drumEvents": "263f32c51ac664131f33f6a869238851b5ddaa487f7cb0187cbb607894c62f3a"
    }
  },
  {
    "style": "straight",
    "mode": "original",
    "engine": "fixed",
    "expected": {
      "bassEvents": "7943b1a7bd315134b9b431bd2a19ed16d6c92b9a7dfc478e404bbaa849e9b241",
      "compEvents": "5da74e4e5b69c57340fe7321e70dfe96c35de1da3af8f1de1f1bb0d588bc223c",
      "drumEvents": "32b45d6401bf1cf33e3ad40d55647ba3352bcbc68f03568ff9afbec6fa96cdb6"
    }
  },
  {
    "style": "straight",
    "mode": "coordinated-implicit",
    "engine": "fixed",
    "expected": {
      "bassEvents": "489a6f0d3f3934210ce58f731853bc35bcc688b5e23ba596ecbdadbda0105a00",
      "compEvents": "d1ab6134106cdd0a4d28fc6efc2e9fb4482e452338dc93156815cb493bccddd6",
      "drumEvents": "8bed2d63d0d297ad0419058911499ddf2ee106fc16f3a6a118880d52b044e54a"
    }
  },
  {
    "style": "straight",
    "mode": "coordinated-implicit",
    "engine": "rolling",
    "expected": {
      "bassEvents": "36262f6dffea2de50504e5da3c9e1852afb161a7602806a6fe185b0c18e91b71",
      "compEvents": "158b5f7b591e654a35ce819858206a9d6ca34529e5b3f8b07238304fee3f5fd0",
      "drumEvents": "e66b490df96ae4e8a1bacf65dac0bf95e5cb146f4e07eb16853d3775bf64819b"
    }
  },
  {
    "style": "bossa-nova",
    "mode": "original",
    "engine": "fixed",
    "expected": {
      "bassEvents": "dd693b2e5b690662e89a2a8cf4346b454a35fbd3b7df7c807208f540c4aa4ecf",
      "compEvents": "ac18c90ddec9e087229ed3fa15a3256361b1f00c5c5c9f6a33b8d5090a45e62c",
      "drumEvents": "2ec8cc42c81989103d27f8564859c4b21ab24c431da9fa2270cf2e445abfec59"
    }
  },
  {
    "style": "bossa-nova",
    "mode": "coordinated-implicit",
    "engine": "fixed",
    "expected": {
      "bassEvents": "7cab12a109f375935d741c17deb3954357471b418ff7453a725b313fe1490136",
      "compEvents": "5c8a485017c209e06ed90a6e0d153f8b097cf0ae211559657f592cd142b74687",
      "drumEvents": "59136b9f8ebf58dbea0375105acf5303c1b54a2e341939cbc32b676f79c1d43c"
    }
  },
  {
    "style": "bossa-nova",
    "mode": "coordinated-implicit",
    "engine": "rolling",
    "expected": {
      "bassEvents": "eaf3618d29d101acf946a18cedd7c6eab96e83c358efd34f772d3bbe4c7f5967",
      "compEvents": "26e59b5cde2a74b6c80c1f70a00c268c6a7ac3a81520a2eec6d7609a6fb4746f",
      "drumEvents": "3e935d63db2c627e2078aa7a6935dfef600676c18520b31c4f170bb58fb89b5a"
    }
  },
  {
    "style": "bossa-nova",
    "mode": "coordinated-explicit",
    "engine": "fixed",
    "expected": {
      "bassEvents": "2241d4c694afb7e2dc351f1dbc5cc03d6b64b8e3b1fc33bbde2f159c86feacc2",
      "compEvents": "176dc3101b3a8ecda9a860718b0d255240d812fddc374fccc44ca2c4a9c9a718",
      "drumEvents": "e0132c901e82323b68d15c09a0bc8e1357a94fcd957b412a55aec9ffc2d05e1e"
    }
  },
  {
    "style": "bossa-nova",
    "mode": "coordinated-explicit",
    "engine": "rolling",
    "expected": {
      "bassEvents": "9baa3e157b797e43a6b47dba981ac5c81c9e5d81f32cfb0db56a47692b899ddd",
      "compEvents": "fa8af1a4f6c7252de764fd75714969672345ef8d48031c43ca0963e2a791edea",
      "drumEvents": "efc622898980a07b254deb5f7168187cef55ad395e20f0a81def3f70d75aa1ce"
    }
  },
  {
    "style": "ballad",
    "mode": "original",
    "engine": "fixed",
    "expected": {
      "bassEvents": "74c300122fc84881442c42bef6d05cd8c5f2b57c11f02e9a54e1bb6a9da6dd87",
      "compEvents": "470f3a206346abcb8b8b2755b5a2a33724c5f88d6e1efd6297bd48bc9db6a31c",
      "drumEvents": "6cd7305163f00110cd9dd114e8d0a8656d61d0265ada6366dbf96798729da42d"
    }
  },
  {
    "style": "ballad",
    "mode": "coordinated-implicit",
    "engine": "fixed",
    "expected": {
      "bassEvents": "7890216cc57faabab00778f638e9e2eb335243d9e9ad65a53c012c996695ad92",
      "compEvents": "3f0c962e949146d243de80d2bceee29a33fa90c6f3e8eb3b56d103cb902d3222",
      "drumEvents": "16314596bc6b199159a90bf580d71ae38e401fbb1b57247df6495703405fc701"
    }
  },
  {
    "style": "ballad",
    "mode": "coordinated-implicit",
    "engine": "rolling",
    "expected": {
      "bassEvents": "86a7cd909f1accc237cb032040198eaca52d4d42903e4b069a1312f20d15a45c",
      "compEvents": "ed0f8219976baa6e5bdfdb4fa57927d3eb2dff1031b65cb0ae30c845ab5417bf",
      "drumEvents": "76b0a22ac031ba172019b5f9f85d24065327301b40ac6891bf3898ffaa9058d7"
    }
  },
  {
    "style": "ballad",
    "mode": "coordinated-explicit",
    "engine": "fixed",
    "expected": {
      "bassEvents": "84d096b3155cfa01cf85f2aaf0b3f3c56c2d0f05984743afdb38fb22534fc42b",
      "compEvents": "8283331f6eafe6f9a1862283927da046b8733f76fc406b27e99cede426c0f8e3",
      "drumEvents": "a68510c01dcaebaffc25747582a87e36f63fce4fb641bc4a291890a61354413d"
    }
  },
  {
    "style": "ballad",
    "mode": "coordinated-explicit",
    "engine": "rolling",
    "expected": {
      "bassEvents": "e8c0f49e9de2adf57f99a7f381904a84925abf2b49a80c63d9f947f669f55497",
      "compEvents": "72b0d64c1fba7cf158658d2a1c04385937110d1ee4b34e1c2b4366613cf25f89",
      "drumEvents": "ecc4dd5e7db3e1d85d445d92bac4d1881bc6ec32827bf0812401beebe71f79e0"
    }
  }
] as const;

it.each(unchanged)('$engine $style $mode preserves the complete pre-change native/legacy performance', ({ engine, style: id, mode, expected }) => {
	const style = BACKING_STYLES[id];
	const { performanceForm, ensemble, ...base } = params;
	const options = { ...base, swing: style.defaultSwing,
		...(mode === 'coordinated-implicit' ? {} : { performanceForm }), ...(mode === 'original' ? {} : { ensemble }) };
	let generated: BossaContourPerformance;
	if (engine === 'fixed') generated = generateBacking(tune.phrase.harmony, style, options);
	else {
		const definition = createRollingBacking(tune.phrase.harmony, style, options);
		const windows = []; let checkpoint;
		for (let bar = 0; bar < definition.totalBars; bar++) {
			const next = advanceRollingBacking(definition, checkpoint); checkpoint = next.checkpoint; windows.push(next);
		}
		generated = { bassEvents: windows.flatMap(window => window.bassEvents), compEvents: windows.flatMap(window => window.compEvents), drumEvents: windows.flatMap(window => window.drumEvents),
			ensembleDevelopment: { version: 1 as const, pianoVoicings: windows.flatMap(window => window.ensembleDevelopment.pianoVoicings ?? []) } };
	}
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
		if (field === 'compEvents' && id === 'bossa-nova' && mode === 'coordinated-explicit') {
			assertBossaContourCompatibility(generated, expected.compEvents);
		} else expect(createHash('sha256').update(JSON.stringify(generated[field])).digest('hex'), field).toBe(expected[field]);
	}
});
