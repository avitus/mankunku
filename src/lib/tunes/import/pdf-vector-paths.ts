/** PDF.js adapter: retain black vector lines/polygons/curves in page pixels.
 * Unknown path encodings decline; no dependence on a recognition provider.
 */
export interface VectorPath {
	points: Array<[number, number]>;
	curved: boolean;
	filled: boolean;
	width: number;
}
import { composePdfTransforms, type PdfOperatorList } from './pdf-operators';
export function extractVectorPaths(
	ops: PdfOperatorList,
	codes: Record<string, number>,
	viewport: number[]
): VectorPath[] {
	let state = { matrix: viewport, stroke: '#000000', fill: '#000000', width: 1 };
	const stack: (typeof state)[] = [];
	const paths: VectorPath[] = [];
	for (let i = 0; i < ops.fnArray.length; i++) {
		const op = ops.fnArray[i],
			a = ops.argsArray[i] as any[] | null;
		if (op === codes.save) stack.push({ ...state });
		else if (op === codes.restore) state = stack.pop() ?? state;
		else if (op === codes.transform && a?.length === 6)
			state = { ...state, matrix: composePdfTransforms(state.matrix, a) };
		else if (op === codes.setStrokeRGBColor && typeof a?.[0] === 'string') state.stroke = a[0];
		else if (op === codes.setFillRGBColor && typeof a?.[0] === 'string') state.fill = a[0];
		else if (op === codes.setLineWidth && typeof a?.[0] === 'number') state.width = a[0];
		else if (op === codes.constructPath && a) {
			const filled = [codes.fill, codes.eoFill, codes.fillStroke, codes.eoFillStroke].includes(
				a[0]
			);
			if (
				!(filled ? state.fill === '#000000' : a[0] === codes.stroke && state.stroke === '#000000')
			)
				continue;
			if (!Array.isArray(a[1])) continue;
			for (const raw of a[1]) {
				if (!Array.isArray(raw) && !ArrayBuffer.isView(raw)) continue;
				const values = Array.from(raw as ArrayLike<number>),
					points: Array<[number, number]> = [];
				let curved = false,
					valid = true;
				for (let j = 0; j < values.length; ) {
					const command = values[j++];
					const count =
						command === 0 || command === 1
							? 2
							: command === 2
								? 6
								: command === 3
									? 4
									: command === 4
										? 0
										: -1;
					if (count < 0 || j + count > values.length) {
						valid = false;
						break;
					}
					if (command === 2 || command === 3) curved = true;
					for (let k = 0; k < count; k += 2) {
						const x = values[j + k],
							y = values[j + k + 1],
							m = state.matrix;
						points.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
					}
					j += count;
				}
				if (valid && points.length >= 2)
					paths.push({
						points,
						curved,
						filled,
						width: state.width * Math.hypot(state.matrix[0], state.matrix[1])
					});
			}
		}
	}
	return paths;
}
