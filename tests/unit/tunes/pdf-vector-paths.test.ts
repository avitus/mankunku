import { it, expect } from 'vitest';
import { extractVectorPaths } from '$lib/tunes/import/pdf-vector-paths';
it('applies nested PDF transforms and excludes colored highlights and unpainted clipping paths', () => {
	const codes = {
		save: 10,
		restore: 11,
		transform: 12,
		constructPath: 91,
		stroke: 20,
		fill: 22,
		eoFill: 23,
		setStrokeRGBColor: 58,
		setFillRGBColor: 59,
		setLineWidth: 2
	};
	const ops = {
		fnArray: [12, 10, 58, 91, 11, 2, 91, 91],
		argsArray: [
			[2, 0, 0, 2, 5, 6],
			null,
			['#ffff00'],
			[20, [new Float32Array([0, 1, 2, 1, 1, 12])]],
			null,
			[0.5],
			[20, [new Float32Array([0, 1, 2, 1, 1, 12])]],
			[28, [new Float32Array([0, 1, 2, 1, 1, 12])]]
		]
	};
	expect(extractVectorPaths(ops, codes, [1, 0, 0, 1, 0, 0])).toEqual([
		{
			points: [
				[7, 10],
				[7, 30]
			],
			curved: false,
			filled: false,
			width: 1
		}
	]);
});
