import { version } from '$app/environment';
import specification from '/documentation/musicality/spec.md?raw';
import { buildMusicalityRequirements } from '$lib/musicality/manifest';

/** Bundle the spec with this release; production does not ship the documentation directory. */
export function load() {
	return { specification, requirements: buildMusicalityRequirements(specification), buildVersion: version };
}
