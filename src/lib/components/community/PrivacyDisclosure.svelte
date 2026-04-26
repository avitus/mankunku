<script lang="ts">
	import {
		hasAcknowledgedCommunityPrivacy,
		acknowledgeCommunityPrivacy
	} from '$lib/persistence/community';

	let acknowledged = $state(hasAcknowledgedCommunityPrivacy());

	function handleAck() {
		acknowledgeCommunityPrivacy();
		acknowledged = true;
	}
</script>

{#if !acknowledged}
	<div
		class="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 py-2 text-xs text-[var(--color-text-secondary)]"
	>
		<p>
			Heads up — the licks you save appear in the
			<a href="/community" class="text-[var(--color-accent)] hover:underline">Community library</a>
			so other players can find and steal them.
		</p>
		<button
			onclick={handleAck}
			class="mt-1 text-xs text-[var(--color-accent)] hover:underline"
		>
			Got it
		</button>
	</div>
{/if}
