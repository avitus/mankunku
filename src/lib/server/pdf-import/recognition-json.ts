/** Decode one provider JSON value; musical contracts remain the caller's responsibility. */
export function parseRecognitionJson(text: string): unknown {
	try {
		return JSON.parse(text.trim());
	} catch {
		// Never choose between alternative answers or attempt syntax repair.
		const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
		if (blocks.length !== 1 || text.replace(blocks[0][0], '').includes('```')) {
			throw new Error('Recognition response needs one unambiguous JSON value');
		}
		return JSON.parse(blocks[0][1]);
	}
}
