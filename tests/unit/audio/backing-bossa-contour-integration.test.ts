import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { resolveCoordinatedVoicing, type CoordinatedVoicingMemory } from '$lib/audio/coordinated-voicing';
import { fractionToFloat } from '$lib/music/intervals';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key: 'F#', soloChoruses: 2 });
const params = { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
// Frozen clean 57b5f943 full-tune signatures; only explicit Bossa placements may change.
const baselineCases = [
	{
		"style": "swing",
		"mode": "original",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "f5905913a739a625dbc465a15f3cd4764a79617b8f813d698a43fc6e3157b6e3",
			"compNonPitches": "f8d6652a2010c189c63e5392042b3b32c10d5b6c8e43c55b9f3d9adb0f12daf5",
			"bassEvents": "3085663d65722fb90f211641c5be5028128e6a54bfbf406b482c8ae0a8f39dd3",
			"drumEvents": "c56adeaee45a27de4aee7aa96bc1801ce5c8de07cd0547c180bfacf547f55e9c",
			"compCount": 80
		},
		"pitchClasses": "bc95522d32fd293ae5873835ef1169f97c91e5aed462326fc57fe655db99595e",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "swing",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "81914b9c1fc200bc44cda42a940bd7858d2c2971754b4ce874663f3a8f993cdb",
			"compNonPitches": "f630bb0e3d25051e1f0f96c6485e0f25f177f0da6d59b8d7cb9d73e66663cf4a",
			"bassEvents": "2180974ea30c38f00aed4b1603c0aaba4da24f1c160333938de7690e87d33ee5",
			"drumEvents": "18b4df34f940e0a4a6ce7360416c60d38a7169b6071a66f244fd31705ac56f65",
			"compCount": 39
		},
		"pitchClasses": "6eb18689f7831425c653b52108b32a609763d821e93ff416dd10bd28d6caad6e",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "swing",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "ba63273d3097f9686ada06aa95caeaf17d160d81888651c3aaeacddfaf054b8e",
			"compNonPitches": "27d7f0751dbd9b64d828431e3c6577514a316094a5126e2c61dab4f0f5aa5a95",
			"bassEvents": "c7f466cb6f5c7a67288cf50554e5b2e65a5d82fee92307e2234a845b6af7204c",
			"drumEvents": "263f32c51ac664131f33f6a869238851b5ddaa487f7cb0187cbb607894c62f3a",
			"compCount": 41
		},
		"pitchClasses": "4cef264ccc8c71960104e06cc25d13ed939fde098a7e03f36186db3f67820fb9",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "swing",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "1e45ce5bcc5de6a48d7a3aff5206ec2790dd9fafe98d756e397bff1e799f23ad",
			"compNonPitches": "b4c35d1dbf4c7018b459c29af812d48ba6d029a659757d5df427a2d90bf3f2db",
			"bassEvents": "2d612e572ed6477779f9deff7b79ca66d19b1b8d9aa7c42f9951ce455b5e4810",
			"drumEvents": "25c1adcc3558774e03fe2ff66a671bd87e99be1ebb2a57b143c527abbefc0974",
			"compCount": 27
		},
		"pitchClasses": "6476d45aa27516b73697f0cfe4064813ad3b58e7ac54ea5428edfc790722a8da",
		"families": "59748171031cd57f36c277ecef8d87ebd0b1a81c5090587b764c38d955de6d95"
	},
	{
		"style": "swing",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "a74ab5790ffeb775d4155096870d947b4eda86e74b2771e2218759c76e652aa6",
			"compNonPitches": "653996d4ebf28f0eea487999f21254fe20908f8333ef89c6784f31bcb529e2a6",
			"bassEvents": "aeda4cce8f650a695d2be81ab05b0f2f1105d1d3865b007ef0bb9a69a473f464",
			"drumEvents": "66d9ad9e267af8109da61ad65347a7672cb36712fff15bb7bcd79fb6a54df013",
			"compCount": 28
		},
		"pitchClasses": "fd74e3b5dfe3ad0707c884b732b82c51760bd317217c1274bdf4c8d6c4b2bd03",
		"families": "b2c525de89640312a03238f2c801198cf612ff0494b1595be2d88bbdf3e1868b"
	},
	{
		"style": "straight",
		"mode": "original",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "5da74e4e5b69c57340fe7321e70dfe96c35de1da3af8f1de1f1bb0d588bc223c",
			"compNonPitches": "eb2361ee319130a8533579021c85256e97126d8c4c4e7bd38cd4441e229290c8",
			"bassEvents": "7943b1a7bd315134b9b431bd2a19ed16d6c92b9a7dfc478e404bbaa849e9b241",
			"drumEvents": "32b45d6401bf1cf33e3ad40d55647ba3352bcbc68f03568ff9afbec6fa96cdb6",
			"compCount": 76
		},
		"pitchClasses": "8a8f22119b2de977a8df9fde9f596f516431846a6aa3e10f1e92751bdea2b60a",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "straight",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "d1ab6134106cdd0a4d28fc6efc2e9fb4482e452338dc93156815cb493bccddd6",
			"compNonPitches": "3b4081045effc37573328ef406427519ef2980253474b1b9dd8aaaa12f10540e",
			"bassEvents": "489a6f0d3f3934210ce58f731853bc35bcc688b5e23ba596ecbdadbda0105a00",
			"drumEvents": "8bed2d63d0d297ad0419058911499ddf2ee106fc16f3a6a118880d52b044e54a",
			"compCount": 38
		},
		"pitchClasses": "351d99c292d2d719b1c2db32d3aa7a6d9e88610232c4a48d3bd4ee5efe4492db",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "straight",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "158b5f7b591e654a35ce819858206a9d6ca34529e5b3f8b07238304fee3f5fd0",
			"compNonPitches": "8ff98e1314cd2dea8e0aa745b0b3f19e290fd3c62dd4126bbf5c3bd680ff3e0c",
			"bassEvents": "36262f6dffea2de50504e5da3c9e1852afb161a7602806a6fe185b0c18e91b71",
			"drumEvents": "e66b490df96ae4e8a1bacf65dac0bf95e5cb146f4e07eb16853d3775bf64819b",
			"compCount": 40
		},
		"pitchClasses": "b373d77d9951bc6a78318bc3061a8ead21fec167de46d2f4f41f5815eecd4d2e",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "straight",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "ee3432f1b903bc4aff1bd42be30e9ef3f302c1da5d5471e52b3b2f46c9076064",
			"compNonPitches": "9ef7f98c2b073700a86698988fdb3b8680b90fedb7d6214c740bf1b9bf4e1aff",
			"bassEvents": "4dc311ef3f47ba0131f5ffa95a43760e9c80d63e4124e823326f5d4cedc14bf9",
			"drumEvents": "fed59306e644ddf9a1fa60998a34259de9e297eb9e88179eb184c1749987e880",
			"compCount": 28
		},
		"pitchClasses": "88cf1aeadb71c2037cb8c44654b07306e9a2e94f99a6e8ad883ea2f9cca5ce01",
		"families": "f52e16b8477951f3dae7094da2ec3ebecc03596e8c32a4707b42bb2522d2893c"
	},
	{
		"style": "straight",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "8b465f61cffadff0414085372cbfb374a031f566a437816009339a8532049cb1",
			"compNonPitches": "27cbaa9858c30995c9d58fd978a6c6259ad11d19fd6316b343be9ad13c4ee193",
			"bassEvents": "0e32568ecebdc3f8b58c9ea6900aa3cb738bacf307c566de695420be02661fea",
			"drumEvents": "0f524471b350897b0d2b9cf28d2fd7f2607d2e1f3de6a601b20d39d2744e345b",
			"compCount": 26
		},
		"pitchClasses": "caa01d8eb5eaa96ddbbf73bf1ea08877e822ea618f5197bec29f45ae4cf0dd6c",
		"families": "74c766ae58ced43c535cd720e9bade24124f51a09262dd9abcf8aa8d158e6e0e"
	},
	{
		"style": "bossa-nova",
		"mode": "original",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "ac18c90ddec9e087229ed3fa15a3256361b1f00c5c5c9f6a33b8d5090a45e62c",
			"compNonPitches": "312dde39d61414ff29cae5c81a77cdbef931a913c42760fa96146f29722c4811",
			"bassEvents": "dd693b2e5b690662e89a2a8cf4346b454a35fbd3b7df7c807208f540c4aa4ecf",
			"drumEvents": "2ec8cc42c81989103d27f8564859c4b21ab24c431da9fa2270cf2e445abfec59",
			"compCount": 123
		},
		"pitchClasses": "ac8e8714a336ccbb459fcae5dd6ec863fde62ac821cc40ccb1d6959dfbe5180f",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "5c8a485017c209e06ed90a6e0d153f8b097cf0ae211559657f592cd142b74687",
			"compNonPitches": "bb9be94f963f21c2d5f295689844885ce7fb8b2480aa0ccf30008105e4c0ae76",
			"bassEvents": "7cab12a109f375935d741c17deb3954357471b418ff7453a725b313fe1490136",
			"drumEvents": "59136b9f8ebf58dbea0375105acf5303c1b54a2e341939cbc32b676f79c1d43c",
			"compCount": 51
		},
		"pitchClasses": "e6291dbf6b5f0decc6b768089eae1432e837d6b03f68aa10fded14c9705395a7",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "26e59b5cde2a74b6c80c1f70a00c268c6a7ac3a81520a2eec6d7609a6fb4746f",
			"compNonPitches": "b862bbfd49d154b119fe905f10c4178707a0a631e1652043a074623f71647d7f",
			"bassEvents": "eaf3618d29d101acf946a18cedd7c6eab96e83c358efd34f772d3bbe4c7f5967",
			"drumEvents": "3e935d63db2c627e2078aa7a6935dfef600676c18520b31c4f170bb58fb89b5a",
			"compCount": 51
		},
		"pitchClasses": "353cedb014f45bede94982413996605a72828cadf52bf64c9c1f0235514fe489",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"pitchControl": false,
		"expected": {
			"compEvents": "176dc3101b3a8ecda9a860718b0d255240d812fddc374fccc44ca2c4a9c9a718",
			"compNonPitches": "88ecab72c38b47451b3d1fa24437937a85d25ee7bfa52ebb872dee8993b6eb98",
			"bassEvents": "2241d4c694afb7e2dc351f1dbc5cc03d6b64b8e3b1fc33bbde2f159c86feacc2",
			"drumEvents": "e0132c901e82323b68d15c09a0bc8e1357a94fcd957b412a55aec9ffc2d05e1e",
			"compCount": 36
		},
		"pitchClasses": "3db3cd60b1514b88e9dbec9b9a1c91b9a52b2992c01f34d2f63c6420bf09385a",
		"families": "4a2283976cc4c46d8c008674a7d464a4fab73a75e8b120cc28f8d2ce8d6b9980"
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"pitchControl": false,
		"expected": {
			"compEvents": "fa8af1a4f6c7252de764fd75714969672345ef8d48031c43ca0963e2a791edea",
			"compNonPitches": "379669ab9dad18f9b3564d99668d13231d21a8604e82f91ec9d4073e92f2bf2f",
			"bassEvents": "9baa3e157b797e43a6b47dba981ac5c81c9e5d81f32cfb0db56a47692b899ddd",
			"drumEvents": "efc622898980a07b254deb5f7168187cef55ad395e20f0a81def3f70d75aa1ce",
			"compCount": 36
		},
		"pitchClasses": "3db3cd60b1514b88e9dbec9b9a1c91b9a52b2992c01f34d2f63c6420bf09385a",
		"families": "4a2283976cc4c46d8c008674a7d464a4fab73a75e8b120cc28f8d2ce8d6b9980"
	},
	{
		"style": "ballad",
		"mode": "original",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "470f3a206346abcb8b8b2755b5a2a33724c5f88d6e1efd6297bd48bc9db6a31c",
			"compNonPitches": "2baba9e07b5abbb82357f27ae01616b62e717977884f0443a070e8ed8bfda351",
			"bassEvents": "74c300122fc84881442c42bef6d05cd8c5f2b57c11f02e9a54e1bb6a9da6dd87",
			"drumEvents": "6cd7305163f00110cd9dd114e8d0a8656d61d0265ada6366dbf96798729da42d",
			"compCount": 55
		},
		"pitchClasses": "5cf10e4a23699bf8f7e3b76395faf75e1eda83b511cb151a6d4d1322e68f5231",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "ballad",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "3f0c962e949146d243de80d2bceee29a33fa90c6f3e8eb3b56d103cb902d3222",
			"compNonPitches": "8172f54132c060ecb3415b27340cb5561874c65dbf39ca21de9cbd12c8128f35",
			"bassEvents": "7890216cc57faabab00778f638e9e2eb335243d9e9ad65a53c012c996695ad92",
			"drumEvents": "16314596bc6b199159a90bf580d71ae38e401fbb1b57247df6495703405fc701",
			"compCount": 31
		},
		"pitchClasses": "59c701ce86b4a0907441bb63ee3762125146df9533dec59414391c6c28fb7e9c",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "ballad",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "ed0f8219976baa6e5bdfdb4fa57927d3eb2dff1031b65cb0ae30c845ab5417bf",
			"compNonPitches": "189a7f16e66bbd80170be509fbf7632878d40806e08619a63e1e3b8c9d1e530c",
			"bassEvents": "86a7cd909f1accc237cb032040198eaca52d4d42903e4b069a1312f20d15a45c",
			"drumEvents": "76b0a22ac031ba172019b5f9f85d24065327301b40ac6891bf3898ffaa9058d7",
			"compCount": 31
		},
		"pitchClasses": "70188b37df2a1bd8900b1be50c0d0cf73137d6372476ae103601b7bd425f80d0",
		"families": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
	},
	{
		"style": "ballad",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "8283331f6eafe6f9a1862283927da046b8733f76fc406b27e99cede426c0f8e3",
			"compNonPitches": "3d813729e557ef903497528415c16ca9f5ed1bdbfd3e3d3202e6dbc8dab0a56c",
			"bassEvents": "84d096b3155cfa01cf85f2aaf0b3f3c56c2d0f05984743afdb38fb22534fc42b",
			"drumEvents": "a68510c01dcaebaffc25747582a87e36f63fce4fb641bc4a291890a61354413d",
			"compCount": 25
		},
		"pitchClasses": "69486cb0827d247db9a22920959d35e8f37a10d02c157c819fb531f1ed14ec46",
		"families": "eef00d40277bf846362754da9e0c0bb3c77c1d7dcb8c8f418b9c60bd83d5349f"
	},
	{
		"style": "ballad",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "72b0d64c1fba7cf158658d2a1c04385937110d1ee4b34e1c2b4366613cf25f89",
			"compNonPitches": "ea83e2e93519ca4142fd5ecb4a450aaf149a2bc7f3a63c64f98f9190d21c6cf6",
			"bassEvents": "e8c0f49e9de2adf57f99a7f381904a84925abf2b49a80c63d9f947f669f55497",
			"drumEvents": "ecc4dd5e7db3e1d85d445d92bac4d1881bc6ec32827bf0812401beebe71f79e0",
			"compCount": 25
		},
		"pitchClasses": "69486cb0827d247db9a22920959d35e8f37a10d02c157c819fb531f1ed14ec46",
		"families": "eef00d40277bf846362754da9e0c0bb3c77c1d7dcb8c8f418b9c60bd83d5349f"
	}
] as const;

it.each(baselineCases)('$style $mode $engine preserves its complete native rhythm and protected controls', ({ style: id, mode, engine, pitchControl, expected, pitchClasses, families }) => {
	const { performanceForm, ensemble, ...plain } = params;
	const input = { ...plain, ...(mode !== 'coordinated-implicit' ? { performanceForm } : {}),
		...(mode !== 'original' ? { ensemble } : {}), swing: BACKING_STYLES[id].defaultSwing };
	const generated = engine === 'fixed' ? generateBacking(phrase.harmony, BACKING_STYLES[id], input) : (() => {
		const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], input);
		let checkpoint;
		const bars = [];
		for (let bar = 0; bar < score.totalBars; bar++) {
			const next = advanceRollingBacking(score, checkpoint);
			checkpoint = next.checkpoint;
			bars.push(next);
		}
		return { bassEvents: bars.flatMap(bar => bar.bassEvents), compEvents: bars.flatMap(bar => bar.compEvents),
			drumEvents: bars.flatMap(bar => bar.drumEvents), ensembleDevelopment: {
				pianoVoicings: bars.flatMap(bar => bar.ensembleDevelopment.pianoVoicings ?? []) } };
	})();
	for (const field of ['bassEvents', 'drumEvents'] as const) expect(hash(generated[field])).toBe(expected[field]);
	expect(hash(generated.compEvents.map(({ notes, ...event }) => event))).toBe(expected.compNonPitches);
	expect(generated.compEvents).toHaveLength(expected.compCount);
	expect(hash(generated.compEvents.map(event => event.notes.map(note => note % 12).sort((a, b) => a - b)))).toBe(pitchClasses);
	const trace = generated.ensembleDevelopment?.pianoVoicings ?? [];
	expect(hash(trace.map(event => [event.decision.requestedFamily, event.decision.resolvedFamily]))).toBe(families);
	if (pitchControl) expect(hash(generated.compEvents)).toBe(expected.compEvents);
	else {
		expect(hash(generated.compEvents)).not.toBe(expected.compEvents);
		expect(trace.some(event => event.decision.topLine?.eligible)).toBe(true);
	}
});

it.each(['ls-mankunku-blues', 'ls-when-the-saints'] as const)('%s protects harmonic ranking using actual accepted Bossa history', tuneId => {
	const session = buildListeningTuneSession({ tuneId, key: 'F#', soloChoruses: 2 });
	const style = BACKING_STYLES['bossa-nova'];
	const score = createRollingBacking(session.phrase.harmony, style, { ...params, phraseId: session.phrase.id,
		performanceForm: session.phrase.performanceForm, sectionMap: session.phrase.sectionMap, swing: style.defaultSwing });
	let checkpoint;
	let actual: CoordinatedVoicingMemory | undefined;
	let improved = 0;
	let rests = 0;
	let anticipations = 0;
	for (let bar = 0; bar < score.totalBars; bar++) {
		const current = advanceRollingBacking(score, checkpoint);
		expect(current.checkpoint.pianoAnswer).toBeUndefined();
		expect(current.checkpoint.pianoRecovery).toBeUndefined();
		expect(current.ensembleDevelopment.pianoAnswers).toBeUndefined();
		expect(current.ensembleDevelopment.pianoRecoveries).toBeUndefined();
		expect(current.ensembleDevelopment.pianoVoicings).toHaveLength(current.compEvents.length);
		for (const [index, event] of current.compEvents.entries()) {
			const trace = current.ensembleDevelopment.pianoVoicings![index];
			const lookup = Math.min(score.totalBars * 4 - 0.001, event.absBeat + (event.absBeat % 1 ? 0.5 : 0));
			const chord = score.harmony.find(segment => lookup >= fractionToFloat(segment.startOffset) * 4 &&
				lookup < (fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration)) * 4)!.chord;
			const input = { chord, family: trace.decision.requestedFamily,
				registerMidi: trace.decision.requestedFamily === 'guide' ? 62 : Math.round(58 + 8 * current.ensemblePlan.bars[0].energy),
				previous: actual, rootlessTexture: current.ensemblePlan.bars[0].piano.rootlessTexture?.request };
			const withoutTarget = resolveCoordinatedVoicing(input);
			const selected = resolveCoordinatedVoicing({ ...input, targetTopMidi: trace.decision.topLine?.targetMidi });
			expect(event.notes).toEqual(selected.notes);
			expect(trace).toMatchObject({ absBeat: event.absBeat, time: event.time, notes: event.notes, decision: selected.decision });
			for (const field of ['requestedFamily', 'resolvedFamily', 'guideMotion', 'commonTones', 'totalMovement'] as const)
				expect(selected.decision[field]).toEqual(withoutTarget.decision[field]);
			if (trace.decision.topLine?.eligible) {
				const target = trace.decision.topLine.targetMidi;
				expect(Math.abs(event.notes.at(-1)! - target)).toBeLessThanOrEqual(Math.abs(withoutTarget.notes.at(-1)! - target));
				if (Math.abs(event.notes.at(-1)! - target) < Math.abs(withoutTarget.notes.at(-1)! - target)) improved++;
			}
			if (event.absBeat % 1) anticipations++;
			actual = selected.memory;
		}
		if (!current.compEvents.length) {
			rests++;
			expect(current.checkpoint.piano.contour).toEqual(checkpoint?.piano.contour);
		} else {
			expect(current.checkpoint.piano.contour?.lastTopMidi).toBe(actual?.notes.at(-1));
			expect(current.checkpoint.piano.contour?.lastBarIndex).toBe(bar);
		}
		expect(current.checkpoint.piano.voicing).toEqual(actual);
		checkpoint = current.checkpoint;
	}
	expect(improved).toBeGreaterThan(0);
	expect(rests).toBeGreaterThan(0);
	expect(anticipations).toBeGreaterThan(0);
});

it.each(['ls-mankunku-blues', 'ls-when-the-saints'] as const)('%s fixed Bossa placements retain the protected ranking from their actual preceding chord', tuneId => {
	const { phrase } = buildListeningTuneSession({ tuneId, key: 'F#', soloChoruses: 2 });
	const style = BACKING_STYLES['bossa-nova'];
	const generated = generateBacking(phrase.harmony, style, { ...params, phraseId: phrase.id,
		performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, swing: style.defaultSwing });
	let actual: CoordinatedVoicingMemory | undefined;
	let improved = 0;
	for (const [index, event] of generated.compEvents.entries()) {
		const trace = generated.ensembleDevelopment!.pianoVoicings![index];
		const plan = generated.ensemblePlan!.bars[Math.floor(event.absBeat / 4)];
		const lookup = Math.min(generated.ensemblePlan!.bars.length * 4 - 0.001,
			event.absBeat + (event.absBeat % 1 ? 0.5 : 0));
		const chord = phrase.harmony.find(segment => lookup >= fractionToFloat(segment.startOffset) * 4 &&
			lookup < (fractionToFloat(segment.startOffset) + fractionToFloat(segment.duration)) * 4)!.chord;
		const input = { chord, family: trace.decision.requestedFamily,
			registerMidi: trace.decision.requestedFamily === 'guide' ? 62 : Math.round(58 + 8 * plan.energy),
			previous: actual, rootlessTexture: plan.piano.rootlessTexture?.request };
		const ordinary = resolveCoordinatedVoicing(input);
		const selected = resolveCoordinatedVoicing({ ...input, targetTopMidi: trace.decision.topLine?.targetMidi });
		expect(event.notes).toEqual(selected.notes);
		expect(trace).toMatchObject({ absBeat: event.absBeat, time: event.time, notes: event.notes, decision: selected.decision });
		for (const field of ['requestedFamily', 'resolvedFamily', 'guideMotion', 'commonTones', 'totalMovement'] as const)
			expect(selected.decision[field]).toEqual(ordinary.decision[field]);
		if (trace.decision.topLine?.eligible) {
			const target = trace.decision.topLine.targetMidi;
			expect(Math.abs(event.notes.at(-1)! - target)).toBeLessThanOrEqual(Math.abs(ordinary.notes.at(-1)! - target));
			if (Math.abs(event.notes.at(-1)! - target) < Math.abs(ordinary.notes.at(-1)! - target)) improved++;
		}
		actual = selected.memory;
	}
	expect(improved).toBeGreaterThan(0);
});

it('keeps actual Bossa targets across two complete passes and restores after rests without Swing dialogue', () => {
	const style = BACKING_STYLES['bossa-nova'];
	const input = { ...params, swing: style.defaultSwing };
	const one = createRollingBacking(phrase.harmony, style, input);
	const two = createRollingBacking(phrase.harmony, style, input, { loopCount: 2 });
	let checkpoint;
	let prefix;
	let rests = 0;
	for (let bar = 0; bar < two.totalBars; bar++) {
		const previous = checkpoint;
		const current = advanceRollingBacking(two, checkpoint);
		checkpoint = current.checkpoint;
		expect(checkpoint.pianoAnswer).toBeUndefined();
		expect(checkpoint.pianoRecovery).toBeUndefined();
		if (!current.compEvents.length) {
			rests++;
			expect(checkpoint.piano.contour).toEqual(previous?.piano.contour);
		} else expect(checkpoint.piano.contour?.lastTopMidi).toBe(current.compEvents.at(-1)!.notes.at(-1));
		if (previous?.piano.contour?.phraseStartBar === checkpoint.piano.contour?.phraseStartBar &&
			previous?.piano.contour?.chorusIndex === checkpoint.piano.contour?.chorusIndex)
			expect(checkpoint.piano.contour?.targetMidi).toBe(previous?.piano.contour?.targetMidi);
		if (bar < 20) {
			prefix = advanceRollingBacking(one, prefix?.checkpoint);
			for (const field of ['bassEvents', 'compEvents', 'drumEvents', 'ensembleDevelopment'] as const)
				expect(current[field]).toEqual(prefix[field]);
		}
		if (bar === 19) {
			expect(current.compEvents.map(event => ({ absBeat: event.absBeat, notes: event.notes })))
				.toEqual([{ absBeat: 77, notes: [56, 63, 64, 71] }, { absBeat: 78.5, notes: [56, 63, 64, 70] }]);
			expect(current.ensembleDevelopment.pianoVoicings?.[0].decision).toMatchObject({
				guideMotion: null, commonTones: [56], totalMovement: 16,
				topLine: { targetMidi: 70, actualMidi: 71, distance: 1, eligible: true }
			});
		}
		if ([0, 17, 18, 19, 50, 51, 52, 70].includes(bar)) {
			expect(advanceRollingBacking(two, JSON.parse(JSON.stringify(checkpoint))))
				.toEqual(advanceRollingBacking(two, checkpoint));
			expect(advanceRollingBacking(two, checkpoint, [{ barIndex: bar + 10, observedAtBar: bar + 10,
				source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }]))
				.toEqual(advanceRollingBacking(two, checkpoint));
		}
	}
	expect(rests).toBeGreaterThan(20);
});
