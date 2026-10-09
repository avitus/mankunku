# E5 — prod spread (own lick only, sampled renderer)

15 takes: ear-training 15.

## Rank agreement with the saved score

| metric | Spearman vs saved | vs notes_hit/total |
|---|---|---|
| m1_raw | 0.029 | 0.371 |
| m2_env | 0.225 | 0.433 |
| m2_env_at | 0.411 | 0.371 |
| m3_chroma | 0.182 | 0.433 |
| m3_chroma_hold | 0.207 | 0.433 |
| m3_chroma_dtw | 0.050 | 0.433 |
| m3_dtw_precision | -0.006 | 0.447 |
| m3_dtw_f1 | 0.065 | 0.447 |
| m4_cqt | 0.125 | 0.433 |
| m4_cqt_hold | 0.257 | 0.433 |
| m4_cqt_dtw | 0.061 | 0.433 |
| m5_cover | 0.179 | 0.433 |
| m5_cover_hold | 0.232 | 0.433 |
| m5_cover_strict | 0.179 | 0.433 |

## Metric by saved grade (median, p10–p90)

| grade | n | m3 | m3 hold | m5 | m5 hold | precision | recall | recall hold |
|---|---|---|---|---|---|---|---|---|
| fair | 1 | 0.42 (0.42–0.42) | 0.50 (0.50–0.50) | 0.06 (0.06–0.06) | 0.08 (0.08–0.08) | 0.08 (0.08–0.08) | 0.05 (0.05–0.05) | 0.08 (0.08–0.08) |
| great | 3 | 0.90 (0.89–0.91) | 0.90 (0.89–0.91) | 0.86 (0.83–0.93) | 0.88 (0.82–0.92) | 0.84 (0.82–0.97) | 0.88 (0.84–0.89) | 0.87 (0.80–0.91) |
| perfect | 11 | 0.82 (0.68–0.94) | 0.91 (0.86–0.95) | 0.86 (0.73–0.93) | 0.92 (0.87–0.94) | 0.97 (0.84–1.00) | 0.77 (0.57–0.90) | 0.89 (0.82–0.92) |

## Disagreements

Saved ≥ 0.85 (great/perfect) but hold-tolerant chroma < 0.80: **0** of 14

| take | saved | grade | hit | m3 | m3 hold | m3 dtw | m5 hold | precision | recall | recall hold |
|---|---|---|---|---|---|---|---|---|---|---|

## Every production take

| take | saved | grade | hit | m3 | m3 hold | m3 dtw | m5 | m5 hold | precision | recall hold |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-07-blue-shake-d19422 | 0.62 | fair | 2/5 | 0.42 | 0.50 | 0.60 | 0.06 | 0.08 | 0.08 | 0.08 |
| 2026-10-06-fourth-fifth-21de62 | 0.94 | great | 2/2 | 0.89 | 0.89 | 0.95 | 0.82 | 0.80 | 0.82 | 0.79 |
| 2026-10-06-flat-third-fifth-bfec50 | 0.94 | great | 2/2 | 0.90 | 0.90 | 0.94 | 0.86 | 0.88 | 0.84 | 0.92 |
| 2026-10-07-four-to-five-3174e3 | 0.94 | great | 4/4 | 0.91 | 0.91 | 0.98 | 0.94 | 0.93 | 1.00 | 0.87 |
| 2026-10-07-fourth-fifth-push-8c9d34 | 0.96 | perfect | 2/2 | 0.82 | 0.95 | 0.96 | 0.86 | 0.94 | 1.00 | 0.89 |
| 2026-10-06-flat-seven-neighbor-971934 | 0.96 | perfect | 3/3 | 0.81 | 0.85 | 0.94 | 0.80 | 0.80 | 0.84 | 0.77 |
| 2026-10-07-blue-shake-a55e5b | 0.98 | perfect | 5/5 | 0.68 | 0.91 | 0.83 | 0.73 | 0.92 | 0.99 | 0.87 |
| 2026-10-06-b3-fourth-fifth-ef1858 | 0.98 | perfect | 3/3 | 0.86 | 0.89 | 0.93 | 0.93 | 0.94 | 0.99 | 0.90 |
| 2026-10-07-sixth-flavor-9f81a7 | 0.98 | perfect | 5/5 | 0.81 | 0.96 | 0.97 | 0.83 | 0.93 | 0.97 | 0.90 |
| 2026-10-06-b3-fourth-fifth-5a4770 | 0.99 | perfect | 3/3 | 0.95 | 0.95 | 0.96 | 0.97 | 0.96 | 1.00 | 0.92 |
| 2026-10-06-full-pent-down-67f810 | 0.99 | perfect | 5/5 | 0.73 | 0.91 | 0.88 | 0.79 | 0.92 | 0.97 | 0.88 |
| 2026-10-06-blue-note-to-fifth-31db04 | 0.99 | perfect | 3/3 | 0.92 | 0.92 | 0.96 | 0.86 | 0.89 | 0.84 | 0.94 |
| 2026-10-07-up-and-over-3a04cc | 0.99 | perfect | 6/6 | 0.89 | 0.89 | 0.92 | 0.87 | 0.87 | 0.93 | 0.82 |
| 2026-10-07-climb-and-cry-d6ea28 | 0.99 | perfect | 6/6 | 0.66 | 0.86 | 0.80 | 0.72 | 0.90 | 0.98 | 0.83 |
| 2026-10-07-root-climb-057ad6 | 1.00 | perfect | 5/5 | 0.94 | 0.94 | 0.97 | 0.91 | 0.91 | 0.93 | 0.90 |

Saved < 0.70 (fair/try-again) but chroma ≥ 0.90: **0** of 1

| take | saved | grade | hit | m3 | m3 dtw | m5 | precision | recall |
|---|---|---|---|---|---|---|---|---|
