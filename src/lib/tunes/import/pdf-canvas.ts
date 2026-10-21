/** Release the native pixel buffer immediately rather than waiting for GC. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
	canvas.width = 0;
	canvas.height = 0;
}

/** Keep the encoded image, not the large temporary canvas backing store. */
export function canvasToPng(canvas: HTMLCanvasElement): string {
	try {
		return canvas.toDataURL('image/png');
	} finally {
		releaseCanvas(canvas);
	}
}
