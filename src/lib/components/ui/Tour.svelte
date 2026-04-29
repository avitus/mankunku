<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { DriveStep, Driver, Config } from 'driver.js';
	import { runTour } from '$lib/tour/driver-config';

	interface Props {
		/** Stable identifier used to record completion in tourState. */
		tourId: string;
		steps: DriveStep[];
		/** Bind to control imperatively; flips back to false on close. */
		active?: boolean;
		onComplete?: () => void;
		onClose?: () => void;
		config?: Partial<Config>;
	}

	let {
		tourId,
		steps,
		active = $bindable(false),
		onComplete,
		onClose,
		config
	}: Props = $props();

	let driverInstance: Driver | null = null;

	$effect(() => {
		if (active && !driverInstance) {
			driverInstance = runTour({
				tourId,
				steps,
				config,
				onComplete: () => {
					driverInstance = null;
					active = false;
					onComplete?.();
				},
				onClose: () => {
					driverInstance = null;
					active = false;
					onClose?.();
				}
			});
		} else if (!active && driverInstance) {
			driverInstance.destroy();
			driverInstance = null;
		}
	});

	onDestroy(() => {
		driverInstance?.destroy();
		driverInstance = null;
	});
</script>
