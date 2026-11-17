# Account settings across browsers

The owner reported that an existing soprano account opened in Safari with tenor
saxophone and 50% swing, despite using soprano and 62% in Firefox. The owner
corrected Safari before investigation; a read-only production query then showed
soprano and 62%. There is no before-correction settings snapshot establishing
the exact sequence of writes. Tenor and 50% are the original database defaults;
50% is also a legitimate user choice and must not be mass-rewritten.

Two reproducible problems existed in the settings sync path:

- Any unsent local change blocked the entire cloud settings record. Even a
  no-op save could prevent a new browser from restoring the account instrument.
- Every save uploaded every setting, so an older browser changing volume could
  overwrite the instrument and swing another device had already corrected.

Settings now persist pending edits per field and send only those fields. Cloud
reads restore untouched fields while preserving pending edits, including edits
whose upload finishes while an older read is still in flight. A flush acknowledges
only the revisions it actually sent. Instrument changes include their range reset.
Existing dirty revision counters without per-field metadata conservatively retain
their unsent settings; there is no reliable way to infer which old fields changed.
Per-tune maps remain whole-field values; this does not introduce per-entry merging.

The browser regression also exposed an unnecessary auth request during pagehide:
the outbox authenticated before checking whether it had any work. WebKit reported
the unload-aborted request as an access-control error. Empty queues now return
before authentication; queued writes retain the existing identity checks.

The change needs no database migration and this investigation made no production
writes. The unit regressions were observed failing before the fix. Targeted
settings, auth-edge-case, cross-context and persistence tests pass (167 tests in
six files). Type checking passes with zero errors and warnings in a Linux
container with a 3 GiB Node heap; the default heap exhausted memory. Browser
validation uses `circleci testsuite run 'e2e tests' --run-tests=all
--analyze-tests=none -t '^(settings-cloud-sync|settings|settings-dials)\.spec\.ts$'`,
which selects three of 128 files and runs them in a Linux sandbox.

The existing settings and dial checks passed (57 browser tests). After fixing
the unload request exposed by the new spec, rerunning just
`-t '^settings-cloud-sync\.spec\.ts$'` passed all six new tests across Chromium,
Firefox and WebKit (one file selected, 127 excluded). Linux WebKit coverage does
not establish native Safari parity. Production remains unchanged.
