<script lang="ts">
	import { renderMarkdown } from '$lib/docs/markdown';

	interface Props {
		markdown: string;
		/** The doc's current slug — used to resolve relative links. */
		slug?: string;
		class?: string;
	}

	let { markdown, slug = '', class: klass = '' }: Props = $props();

	const rendered = $derived(renderMarkdown(markdown, slug));
</script>

<div class="prose-docs {klass}">
	{@html rendered.html}
</div>
