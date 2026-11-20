import {
	fitRoom,
	validateRoom,
	checkRoomTiming,
	type RoomFilter,
	type RoomSamples
} from './room-filter';

self.onmessage = ({ data }: MessageEvent<RoomSamples & { filter?: RoomFilter }>) => {
	try {
		if (data.filter) {
			self.postMessage({ check: checkRoomTiming(data, data.filter) });
			return;
		}
		const filter = fitRoom(data, Math.floor(data.rate * 3));
		// The last two seconds contain independent noise. Skip the boundary
		// by more than the longest possible filter before checking both halves.
		const reduction = validateRoom(data, filter, Math.round(3.55 * data.rate));
		if (Number.isFinite(reduction) && reduction >= 3) {
			self.postMessage({ filter, reduction }, { transfer: [filter.left.buffer, filter.right.buffer] });
		} else {
			self.postMessage({ reduction });
		}
	} catch {
		self.postMessage({ error: true });
	}
};
