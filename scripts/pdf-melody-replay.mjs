/** Select recorded melody calls while leaving header, harmony and QA live. */
/** @typedef {{ model: string, system: string, messages: Array<{ content: Array<{ type: string, source?: { data: string } }> }> }} ReplayInput */
/** @param {Array<{input: ReplayInput, response?: unknown, error?: string}>} records */
export function createMelodyReplay(records) {
	const used = new Set();
	/** @param {ReplayInput} input */
	function replay(input) {
		if (!input.system?.startsWith('You are a music COPYIST.')) return null;
		const image = input.messages[0].content.find((b) => b.type === 'image')?.source?.data;
		const index = records.findIndex(
			(r, i) =>
				!used.has(i) &&
				r.input?.model === input.model &&
				r.input?.system?.startsWith('You are a music COPYIST.') &&
				r.input.messages[0].content.find((b) => b.type === 'image')?.source?.data === image
		);
		if (index < 0) throw new Error('No recorded melody attempt matches this image and model');
		used.add(index);
		return records[index];
	}
	return replay;
}
