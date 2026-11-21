/** Re-engraving can change the chart's height. Apply the new width on the
 * next frame so the resized score does not invalidate its own observer. */
export function observeChartWidth(host: HTMLElement, publish: (width: number) => void) {
	let width = host.clientWidth;
	let frame = 0;
	publish(width);
	const observer = new ResizeObserver(() => {
		const next = host.clientWidth;
		if (next === width) return;
		width = next;
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => publish(width));
	});
	observer.observe(host);
	return {
		destroy() {
			cancelAnimationFrame(frame);
			observer.disconnect();
		}
	};
}
