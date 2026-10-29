/** Musical behavior identity, independent of an application build or archive schema. */
export interface MusicalityRelease {
 readonly version: string;
 /** Verified engine baseline; UI-only changes do not advance this revision. */
 readonly engineRevision: string;
 readonly status: 'listening-preview';
}

/** First numbered listening release. Automated checks are not human acceptance. */
export const CURRENT_MUSICALITY_RELEASE: Readonly<MusicalityRelease> = Object.freeze({
 version: '0.1.0',
 engineRevision: '545c67b1a1e69c0c997d6232fdf897a8cd066978',
 status: 'listening-preview'
});

/** Validate historical identities without substituting the currently installed version. */
export function isMusicalityRelease(value: unknown): value is MusicalityRelease {
 if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
 const release = value as Record<string, unknown>;
 return Object.keys(release).length === 3 && typeof release.version === 'string' &&
  release.version.length <= 50 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.version) &&
  typeof release.engineRevision === 'string' && /^[0-9a-f]{40}$/.test(release.engineRevision) &&
  release.status === 'listening-preview';
}

/** Missing legacy identities match only other missing identities. */
export function sameMusicalityRelease(a: MusicalityRelease | undefined, b: MusicalityRelease | undefined): boolean {
 return a === undefined || b === undefined ? a === b
  : a.version === b.version && a.engineRevision === b.engineRevision && a.status === b.status;
}
