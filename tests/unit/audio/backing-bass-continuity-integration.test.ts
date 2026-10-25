import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateBacking } from '$lib/audio/backing-generation';
import { createRollingBacking, advanceRollingBacking } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';

function fixture(key: 'C' | 'Eb' | 'F#', variant = 0) {
	const { phrase } = buildListeningTuneSession({ tuneId: 'ls-mankunku-blues', key, soloChoruses: 2 });
	const params = { phraseId: phrase.id + (variant ? ':reply:1' : ''), tempo: 140, ppq: 192, beatsPerBar: 4,
		performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };
	return { phrase, params };
}

describe('real Blues scalar continuation across harmony', () => {
	it.each(['swing', 'straight'] as const)('%s fixed: continues the accepted rise without changing its following approach device', id => {
		const { phrase, params } = fixture('F#', 1);
		const result = generateBacking(phrase.harmony, BACKING_STYLES[id], { ...params, swing: BACKING_STYLES[id].defaultSwing });
		const pulse = result.bassEvents.filter(e => [91, 92, 93, 94, 95, 96].includes(e.absBeat));
		// Baseline42→43→42 reversed before the reserved42→43 chromatic approach.
		expect(pulse.map(e => e.midi)).toEqual([42, 43, 45, 42, 43, 44]);
		expect(result.ensembleDevelopment!.bassContinuations!.find(t => t.boundaryAbsBeat === 92))
			.toEqual({ barIndex: 23, boundaryAbsBeat: 92, direction: 'up',
				notes: pulse.slice(0, 3).map(({ absBeat, time, midi }) => ({ absBeat, time, midi })) });
	});

	it.each(['swing', 'straight'] as const)('%s fixed: preserves the one-note-device segment with two free interior beats', id => {
		const { phrase, params } = fixture('C');
		const result = generateBacking(phrase.harmony, BACKING_STYLES[id], { ...params, swing: BACKING_STYLES[id].defaultSwing });
		expect(result.bassEvents.filter(e => [91, 92, 93, 94, 95, 96].includes(e.absBeat)).map(e => e.midi))
			.toEqual([39, 37, 39, 40, 37, 38]);
		expect(result.ensembleDevelopment!.bassContinuations?.find(t => t.boundaryAbsBeat === 92)).toBeUndefined();
	});

	it.each(['swing', 'straight'] as const)('%s rolling: continues into the unchanged chromatic device, preserves checkpoints and obeys current restraint', id => {
		const { phrase, params } = fixture('Eb', 1);
		const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], { ...params, swing: BACKING_STYLES[id].defaultSwing });
		let previous;
		for (let bar = 0; bar < 23; bar++) previous = advanceRollingBacking(score, previous?.checkpoint);
		const stored = JSON.stringify(previous);
		const current = advanceRollingBacking(score, previous!.checkpoint);
		const pulse = [previous!.bassEvents.find(e => e.absBeat === 91)!, ...current.bassEvents.filter(e => Number.isInteger(e.absBeat))];
		// Baseline35→36→34 becomes35→36→37, then keeps device39→40 and next target41.
		expect(pulse.map(e => e.midi)).toEqual([35, 36, 37, 39, 40]);
		expect(advanceRollingBacking(score, current.checkpoint).bassEvents.find(e => e.absBeat === 96)!.midi).toBe(41);
		expect(current.ensembleDevelopment.bassContinuations).toEqual([{ barIndex: 23, boundaryAbsBeat: 92, direction: 'up',
			notes: pulse.slice(0, 3).map(({ absBeat, time, midi }) => ({ absBeat, time, midi })) }]);
		expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(previous!.checkpoint)))).toEqual(current);
		expect(advanceRollingBacking(score, previous!.checkpoint, [{ barIndex: 30, observedAtBar: 30, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }])).toEqual(current);
		const dense = advanceRollingBacking(score, previous!.checkpoint, [{ barIndex: 23, observedAtBar: 23, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }]);
		expect(dense.ensembleDevelopment.bassContinuations ?? []).toEqual([]);
		expect(dense.bassEvents.filter(e => [92, 94, 95].includes(e.absBeat)).map(e => e.midi)).toEqual([36, 39, 40]);
		expect(JSON.stringify(previous)).toBe(stored);
	});
});

// Exact event signatures captured from clean9eac426b before the bass policy changed.
const controls = [
	{"style":"swing","mode":"original","engine":"fixed","expected":{"bassEvents":"5f1b1e7a71e99f028490d61669223665df0ffcd9709204f8f4e8806f4f399505","compEvents":"837a11bd0796081e6bc97738c2bd5ca7d89744370bad3e4c476bf6a7af574db5","drumEvents":"0f7814a2cf16b7fc08fdad1381fec65ff0d65bc9972116b9598e3f68f46d502e"}},
	{"style":"swing","mode":"coordinated-implicit","engine":"fixed","expected":{"bassEvents":"0ff263499bc688bf7e07a502776ed80c494f043273cdd0cd78e9932558af1a0a","compEvents":"7e501ec9f35d7d8f0791d178c641615b2a17782c0e958ccb99c57f3896f62c12","drumEvents":"bc3ae7878929fdc58ba4786994250ec2b70483b26e1f5906b31d5c40a97c0779"}},
	{"style":"swing","mode":"coordinated-implicit","engine":"rolling","expected":{"bassEvents":"698b291c9950edd5993da7143c1caa852f5379ee226290bf6919d1eee0f1fb48","compEvents":"ba73f7b483cc9fddc5d8a7a200fb571af20b89b40374fd45bd840639b3584095","drumEvents":"f7a79a9f4646cb37b7ffb678d9abd7d402d04e6373951696ce6e1427edfa8f8d"}},
	{"style":"straight","mode":"original","engine":"fixed","expected":{"bassEvents":"05b9d9204d486bd1fe4220d2dabc45103c00e47800c551dff4d2eb9d59856246","compEvents":"04e5c3552cb8939e657e0ae539393c9970e7f00cc8a7945b64e8bf0d3ebf23ad","drumEvents":"33d55ce1da4d9748b93dac873ec37238aafdc074fd7152954e0f9f946d9bc699"}},
	{"style":"straight","mode":"coordinated-implicit","engine":"fixed","expected":{"bassEvents":"7759bd45a13858befb0f204a0cd028334561caf824d1e072cd64f807ce6a242d","compEvents":"f626be69d35642a9514fda7a40b4b570190ee46c74be599e4b3eed5a2724b0c7","drumEvents":"ba76804575a6defcebb38f0cc3755d16aa37c3a013d20bbc9f3dbc74533840ba"}},
	{"style":"straight","mode":"coordinated-implicit","engine":"rolling","expected":{"bassEvents":"3956095e93af1c379963cc2c28641e2a475733cc9bd32edbfd73d26ebb56be88","compEvents":"4421dd22d5080f5417cd411bbccfd70b3d13dcc441a1b46c334a07fa978fdf0f","drumEvents":"c5d5d3c080bdcf96466f16c8558efe9545cbc05fdcedd38cdbca3a4b7aa2f81b"}},
	{"style":"bossa-nova","mode":"original","engine":"fixed","expected":{"bassEvents":"b7ca506304180840c6f916e4c3c4f1b86f375459590e3c99c143fde4d36d796c","compEvents":"ed765156dbc560d673cd3622d73f941f5e62a92c268a115db6b7b39bd7171176","drumEvents":"bd27af4f95ae48a326ca315ddf5f8cb384100a57d3d657aa025b1519e6b13627"}},
	{"style":"bossa-nova","mode":"coordinated-implicit","engine":"fixed","expected":{"bassEvents":"7b2a4eefe0425ac709620979effba5ef881ee57e21fc1caecc1ba38189409bdd","compEvents":"2537c6fa751bb74d8ce448237e435ef9bec842e0238ba516c3983a9d93e4e896","drumEvents":"74d4b32709ad38bbb70fde9b4f069e7ee6316902f127af3129d2b7189a398452"}},
	{"style":"bossa-nova","mode":"coordinated-implicit","engine":"rolling","expected":{"bassEvents":"5a17d9d42f4de18deb4673d9d4a42a04b44042ec89eadc18be488350613845e3","compEvents":"6c6e37f0fdb3bc6e5a1a95f117c3742877b551a27590e86f4e54339a551f38eb","drumEvents":"df9f9c7ccd9f076049806cda3e40ae28c05051a2440ffc01e665125f033ed6c9"}},
	{"style":"bossa-nova","mode":"coordinated-explicit","engine":"fixed","expected":{"bassEvents":"0e5ef2de2ece895e9f9f5845d46afb3ab178e8a81a77c426942a3baf2cc24bae","compEvents":"512c7777705c5663eff4761d0220a0eed2c89d5d24f1119aeab31da426e36bb2","drumEvents":"1517dba211a25299dc50b2850123a92471a884b4353737f2c180301f30f857b5"}},
	{"style":"bossa-nova","mode":"coordinated-explicit","engine":"rolling","expected":{"bassEvents":"1c973f6ad25bb803915019984e40e7a913cbde5fb29f524e880e25ce007fc93e","compEvents":"498bc292a4f0fd0a3691bbadfdde50081310484d70e3e2e1317926761ee1b547","drumEvents":"a8ec02172a0048e66d17440db5a9adc93b1b3a6b2d6d0f0192f1090906fa3ab1"}},
	{"style":"ballad","mode":"original","engine":"fixed","expected":{"bassEvents":"56080b2b1a67a5b60f58f604adca3e55f29364383d4bc2bfc48641774ac70ece","compEvents":"cb67822d95534cbcc0e22f8bb15dbfd9439dd009201bf47c4e46cf17fee6686c","drumEvents":"c4f1cd467e52e1e1f1cc84c667ca2220dd2d44d4938db58af23a731ca7313ed8"}},
	{"style":"ballad","mode":"coordinated-implicit","engine":"fixed","expected":{"bassEvents":"268f31375f33c075cce2287bec033036ac600aa003296036a6ee34fdbd85b2c9","compEvents":"727874c68c79d69a243194952a04f132eb851a04041f7acdd350c82154598fcd","drumEvents":"ffb9bd686eea0a4fcb928e2bed9b1ea9243a098c14d0d679718265334c840526"}},
	{"style":"ballad","mode":"coordinated-implicit","engine":"rolling","expected":{"bassEvents":"ceb2e5a3645b30f6b5cead143ea540993689e846a73540662501251fabe07119","compEvents":"cac927f770cfe893756efbf9bc5933a872b1cdc63a13cb44839b6d545f1ec50b","drumEvents":"3e90316509f36476f0c3e74b6c588e3015a8ff5e4ddf27addda2bc4cc1e08bb1"}},
	{"style":"ballad","mode":"coordinated-explicit","engine":"fixed","expected":{"bassEvents":"23f13c67cacc8d7911e58990b21c928048807aed96ed2eab443cb58b1c60a2d0","compEvents":"ea6d4f10847c25f857451d48e21c5682d8daf5546be0015693cbab7fea09fd64","drumEvents":"9e1ccab15ef814643070f0426101e4e677528ed8f1bbcc7b6c4d03189c6ef4e3"}},
	{"style":"ballad","mode":"coordinated-explicit","engine":"rolling","expected":{"bassEvents":"ace77dbf237f3ca5aaa8ad3c7b8f39f74777d54ca545229c94cf3558fd77c698","compEvents":"a899a7e538954a34249a9cb54a9d1c65742b7e834e92aea3ef9602d3adda5096","drumEvents":"6d6a328f350741aac75aa4f398ac1c419e540310f0eb81695196477835e1182d"}}
] as const;

it.each(controls)('$style $mode $engine preserves the complete baseline performance', ({ style: id, mode, engine, expected }) => {
	const { phrase, params: explicit } = fixture('Eb', 1);
	const { performanceForm, ensemble, ...plain } = explicit;
	const params = { ...plain, ...(mode !== 'coordinated-implicit' ? { performanceForm } : {}),
		...(mode !== 'original' ? { ensemble } : {}), swing: BACKING_STYLES[id].defaultSwing };
	const generated = engine === 'fixed' ? generateBacking(phrase.harmony, BACKING_STYLES[id], params) : (() => {
		const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], params);
		const bars = []; let checkpoint;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const next = advanceRollingBacking(score, checkpoint); checkpoint = next.checkpoint; bars.push(next);
		}
		return { bassEvents: bars.flatMap(b => b.bassEvents), compEvents: bars.flatMap(b => b.compEvents), drumEvents: bars.flatMap(b => b.drumEvents) };
	})();
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const)
		expect(createHash('sha256').update(JSON.stringify(generated[field])).digest('hex')).toBe(expected[field]);
});
