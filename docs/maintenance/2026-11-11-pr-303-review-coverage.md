# PR #303: incomplete CodeRabbit coverage

Investigated 2026-11-11. All times below are Pacific Standard Time (UTC−08:00).

## Finding

PR [#303](https://github.com/avitus/mankunku/pull/303) merged with a real,
unresolved CodeRabbit coverage gap. The original
[review submission](https://github.com/avitus/mankunku/pull/303#pullrequestreview-5854423236)
explicitly lists **one file exceeding a per-file size limit**:

`tests/fixtures/recordings/2026-11-10-blue-note-drop.json`

The fixture at the merged head is 108,780 bytes. GitHub's PR-files API reports
3,524 added lines and omits its `patch` field. CodeRabbit explicitly identifies
its own per-file size limit; the exact limit and whether GitHub's missing patch
also contributed are not exposed in these records. Repeating the same review
without changing the input or addressing the limit would not establish recovery.

This is fixture data, not an unidentified application-source omission. The PR
contains 49 changed files. The initial review selected 46 files and the final
increment selected seven; their union accounts for 48 files, including the
oversized JSON. The remaining WAV was explicitly excluded by `!**/*.wav` in
CodeRabbit's reported effective filters. The repository YAML itself does not
declare that WAV filter. Selected-file counts alone must not be described as
completed coverage.

## Review and merge sequence

| Event | Time on November 10 | Evidence |
| --- | --- | --- |
| Initial review submitted for `46eb32e10bf9108df5a7025b43c64e4d201b9469`; oversized JSON explicitly named | 9:48:11 p.m. | [Review](https://github.com/avitus/mankunku/pull/303#pullrequestreview-5854423236) |
| Initial check finished successfully **with incomplete coverage** | 9:52:29 p.m. | [Check 130347050992](https://github.com/avitus/mankunku/runs/130347050992) |
| Final incremental review submitted for `a245ac8d39b9c27d5a32a23588476c5bfec56999` | 9:59:13 p.m. | [Review](https://github.com/avitus/mankunku/pull/303#pullrequestreview-5854503150) |
| Final check finished successfully **with incomplete coverage** | 10:04:20 p.m. | [Check 130351603806](https://github.com/avitus/mankunku/runs/130351603806) |
| PR merged as `f6c7a093e56916219676d7af3ec839d4531fbb10` | 10:05:15 p.m. | [PR](https://github.com/avitus/mankunku/pull/303) |
| Redundant runs cancelled because the PR was closed | 10:05:24 and 10:09:24 p.m. | [First cancellation](https://github.com/avitus/mankunku/runs/130355932128), [second cancellation](https://github.com/avitus/mankunku/runs/130357422545) |

The final increment covered seven changed source/test files between `46eb32e`
and `a245ac8`; it did not revisit the JSON fixture. Its clean-looking review
submission therefore did not repair the earlier full-diff coverage gap.

## Warnings hidden by later comment edits

The edit history of CodeRabbit's
[walkthrough comment](https://github.com/avitus/mankunku/pull/303#issuecomment-6788039346)
(database ID `6788039346`, available through GraphQL `userContentEdits`) preserves
warnings absent from the current visible body:

- The 9:48:07 and 9:52:26 p.m. versions report that LanguageTool could not check
  every text chunk in `documentation/architecture/design-system.md` and
  `documentation/architecture/harmonic-analysis.md`. They also report one file
  with incomplete review coverage.
- The 9:52:58 p.m. version still reports the one-file coverage warning while
  showing the new seven-file review scope.
- The 9:59:11 p.m. and later versions no longer show those warnings. The final
  check nevertheless still reports incomplete coverage. Neither documentation
  file nor the fixture is in the seven-file increment; warning removal is not
  evidence that their omitted analysis completed.

The LanguageTool failures are separate recorded analysis gaps, not evidence of
additional application files skipped by the code reviewer. The records do not
establish successful reruns of those checks.

## Feedback disposition and remaining work

All five inline review threads were resolved. The PR conversation records fixes
for the pagination, mode-specific copy and test-locator findings, as well as
reasons for retaining owner-requested labels and report behavior. See the
[initial disposition](https://github.com/avitus/mankunku/pull/303#issuecomment-6788249084)
and [additional-comment disposition](https://github.com/avitus/mankunku/pull/303#issuecomment-6788389565).
Addressing findings and passing CI did not complete the missing review coverage.

This investigation does not certify the historical review as complete. It adds
the mandatory completion rule to `AGENTS.md`; it does not change provider
settings, exclude the fixture, manufacture a successful status, or trigger a
review on a closed PR. Completing the outstanding hosted coverage would require
a reviewable follow-up that addresses the file-size limitation and obtains
explicit completed review evidence, together with disposition of the failed
documentation analysis. Any accepted exception must be explicit and recorded.
