# Tunes Compact Desk implementation

The approved 2026-11-17 Compact Desk prototype is implemented in native Svelte 5
on `/tunes`, using the existing Studio Desk tokens and `LibraryPagination`.
Controls move into the right rail; mobile Browse reveals them above the list.
Catalog rows omit key, meter and length while retaining composer and attribution.
The detail/practice music controls retain their existing behavior.

Recent contains the two newest available canonical tune IDs in the selected
collection, ordered by opening or starting playback. The local, per-account
history retains 50 IDs so deleted/returned tunes can be skipped. Search includes
recent tunes; the unfiltered remainder excludes them before sorting and paging.
No migration, cloud history or fabricated initial activity is involved.

## Verification

- Linux production build and `svelte-check`: zero errors and warnings. The check
  used a 3 GB Node heap inside the existing 4 GB sandbox limit; the default Node
  heap exhausted before diagnostics completed.
- Persistence/storage unit tests: 20 passed. A disposable-container mutation
  that appended visits instead of moving them to the front failed the ordering
  and retained-history assertions; restoring the implementation passed.
- The three affected browser specs ran across Chromium, Firefox and WebKit:
  70 passed, with the pagination case failing only its zero-tolerance scroll bound
  in Chromium/WebKit. After correcting that test to allow one pixel of rounding,
  the same pagination case passed on all three engines (3/3, no retries). Artifacts:
  `test-results/sandbox/mankunku-test-b2097b07-dbe2-43d3-b091-31d52770ffdf/` and
  `test-results/compact-desk-pagination/`. The tested production source is unchanged
  between those runs.
- Browser coverage exercises real detail/practice visits, reload, deletion,
  searching recent items, collection scope, pagination without duplicates,
  keyboard focus, import links, cards/compact views and responsive Browse.
- Desktop, tablet and phone layouts were inspected in both themes. Geometry
  assertions cover 1440, 768 and 390 px widths, at least eight visible desktop
  rows and no horizontal overflow. Injecting a 500 px gap above the collection
  failed the first-row position assertion (672 px versus the 250 px limit).
- Direct review checked route links, hydration, namespaced storage, attribution,
  removed catalog metadata, and preservation of existing chart/playback settings.

The Firefox 1572 test driver repeatedly crashed with a native SIGSEGV during
label lookup after pagination and during a nested role/viewport assertion.
Using the accessible searchbox role and the heading's focus/bounding rectangle
exercised the same interactions successfully, without browser exclusions or
production workarounds. Viewport bounds allow one pixel for fractional scroll
rounding (Chromium/WebKit positioned the heading at -0.25 px). Detail-navigation tests
wait for font readiness before leaving so they do not abort a pending font fetch.

No pull request, hosted review, merge or deployment is part of this change.
