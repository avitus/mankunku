import {
	fitRoom,
	learnRoomSession,
	validateRoom,
	verifyRoom,
	type RoomFilter,
	type RoomSession,
	type RoomSamples
} from './room-filter';

self.onmessage = ({ data }: MessageEvent<RoomSamples & { filter?: RoomFilter; session?: RoomSession; learnOffset?: number; includeAudio?: boolean }>): void => {
	try {
		if (data.filter) {
			if (data.learnOffset !== undefined) {
				self.postMessage({ session: learnRoomSession(data, data.filter, data.learnOffset, data.session) });
				return;
			}
			const result = verifyRoom(data, data.filter, data.session);
			if (data.includeAudio || result.check?.accepted) {
				const { mic, left, right, rate } = data;
				self.postMessage({ ...result, captureAudio: data.includeAudio, samples: { mic, left, right, rate } },
					{ transfer: [mic.buffer, left.buffer, right.buffer] });
			} else self.postMessage(result);
			return;
		}
		// A silent Master gives us no speaker signal to test against. In
		// particular it must not replace a previously working room profile.
		if (!data.left.some(Boolean) && !data.right.some(Boolean)) {
			self.postMessage({ silentOutput: true });
			return;
		}
		// Duplex input buffering can shift the return by several samples during
		// startup. Fit after the opening hiss has exercised both devices.
		const start = Math.round(data.rate * 2.4);
		const end = Math.round(data.rate * 3.8);
		const training = {
			rate: data.rate,
			left: data.left.subarray(start, end),
			right: data.right.subarray(start, end),
			mic: data.mic.subarray(start, end)
		};
		const filter = fitRoom(training, end - start);
		// Reserve two unseen windows beyond the entire fitted impulse response.
		const reduction = validateRoom(data, filter, end + filter.left.length);
		if (Number.isFinite(reduction) && reduction >= 3) {
			self.postMessage({ filter, reduction }, { transfer: [filter.left.buffer, filter.right.buffer] });
		} else {
			self.postMessage({ reduction });
		}
	} catch {
		self.postMessage({ error: 'Room estimation failed' });
	}
};
