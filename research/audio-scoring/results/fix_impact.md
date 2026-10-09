# Step 1 — what the scorer fixes do to every saved session

Production `session_results`: 1943 sessions (all ear training, 100–105 BPM). Rescoring the saved pairs reproduces the saved overall to within 5.2e-07.

Firefox takes: 378 (lick-practice 356, ear-training 22), with the audio metrics beside them.

F2 (no rhythm credit for a wrong pitch) and F4 (note length) are off by Andy's decision (2026-10-07).

### Production, ear training (1943 sessions)

| variant | perfect | great | good | fair | try-again | mean overall | sessions moved down a grade | moved up |
|---|---|---|---|---|---|---|---|---|
| saved | 809 | 252 | 309 | 304 | 269 | 0.811 | 0 | 0 |
| F1 gated | 733 | 127 | 280 | 373 | 430 | 0.755 | 420 | 0 |
| F1 naive | 557 | 87 | 330 | 412 | 557 | 0.701 | 727 | 0 |
| F3 | 764 | 276 | 310 | 311 | 282 | 0.804 | 99 | 0 |
| F1 gated + F3 | 702 | 146 | 279 | 369 | 447 | 0.748 | 478 | 0 |

### Firefox, lick practice (356 sessions)

| variant | perfect | great | good | fair | try-again | mean overall | sessions moved down a grade | moved up |
|---|---|---|---|---|---|---|---|---|
| saved | 233 | 66 | 30 | 16 | 11 | 0.915 | 0 | 0 |
| F1 gated | 207 | 61 | 47 | 22 | 19 | 0.889 | 64 | 0 |
| F1 naive | 97 | 77 | 111 | 37 | 34 | 0.811 | 213 | 0 |
| F3 | 226 | 67 | 35 | 16 | 12 | 0.909 | 15 | 0 |
| F1 gated + F3 | 202 | 61 | 49 | 24 | 20 | 0.883 | 74 | 0 |

### Firefox, ear training (22 sessions)

| variant | perfect | great | good | fair | try-again | mean overall | sessions moved down a grade | moved up |
|---|---|---|---|---|---|---|---|---|
| saved | 4 | 6 | 9 | 1 | 2 | 0.820 | 0 | 0 |
| F1 gated | 4 | 4 | 7 | 4 | 3 | 0.772 | 5 | 0 |
| F1 naive | 3 | 4 | 6 | 5 | 4 | 0.742 | 8 | 0 |
| F3 | 3 | 7 | 9 | 1 | 2 | 0.811 | 1 | 0 |
| F1 gated + F3 | 3 | 5 | 7 | 4 | 3 | 0.764 | 6 | 0 |

### Extras in production

Sessions with at least one extra: 895 of 1943; with a GATED extra: 550; mean extras per session 0.81, mean gated 0.40. Perfect sessions losing the grade under F1 gated: 76 of 809; under F1 naive: 252.

### Audio cross-check (Firefox lick practice)

Takes F1 gated charges: 87 of 356 (mean drop 0.106). Their DTW precision median 0.81 vs 0.94 for uncharged takes; frame precision 0.62 vs 0.85.

Spearman(drop under F1 gated, DTW precision) over charged takes: -0.04 (negative = bigger drops where the audio also reads lower).

Possible false charges — saved perfect, DTW precision ≥ 0.90, yet charged: **17** of 26 charged perfect takes.

| take | saved | F1 gated | charged | extras | DTW precision |
|---|---|---|---|---|---|
| 2026-10-06-apple-jump-467206 | 0.965 | 0.789 | 2 | 2 | 0.97 |
| 2026-07-16-cry-me-a-river-591a02 | 0.980 | 0.840 | 1 | 1 | 0.91 |
| 2026-10-06-art-pepper-stardust-d470e8 | 0.980 | 0.840 | 1 | 1 | 0.99 |
| 2026-10-06-dexter-gordon-go-chromatic-75541b | 0.971 | 0.832 | 2 | 4 | 0.92 |
| 2026-10-06-chromatic-below-chord-tones-109dc8 | 0.988 | 0.856 | 2 | 6 | 0.95 |
| 2026-10-06-chromatic-below-chord-tones-0231fe | 0.954 | 0.827 | 2 | 3 | 0.96 |
| 2026-10-06-blue-monk-d6de0d | 0.988 | 0.878 | 1 | 2 | 0.94 |
| 2026-10-06-apple-jump-3176c5 | 0.982 | 0.883 | 1 | 5 | 0.92 |
| 2026-10-06-apple-jump-1d4acd | 0.980 | 0.882 | 1 | 3 | 0.96 |
| 2026-07-16-apple-jump-043d9b | 0.976 | 0.878 | 1 | 3 | 0.90 |
| 2026-10-06-apple-jump-9b78ca | 0.976 | 0.878 | 1 | 5 | 0.93 |
| 2026-10-06-sharp-9-flat-9-dom-e45b07 | 0.961 | 0.865 | 1 | 1 | 0.93 |
| 2026-10-06-fats-navarro-wail-d9814a | 0.987 | 0.929 | 1 | 3 | 0.93 |
| 2026-10-06-fats-navarro-wail-b437d8 | 0.983 | 0.925 | 1 | 4 | 0.94 |
| 2026-07-16-eric-alexander-chord-tone-lick-d75f62 | 0.977 | 0.920 | 1 | 1 | 0.92 |

Spearman(saved overall, DTW F1) on lick practice: 0.645; with frame coverage hold: 0.639

Spearman(F1 gated overall, DTW F1) on lick practice: 0.654; with frame coverage hold: 0.656

Spearman(F3 overall, DTW F1) on lick practice: 0.625; with frame coverage hold: 0.668

Spearman(F1 gated + F3 overall, DTW F1) on lick practice: 0.640; with frame coverage hold: 0.682

### The Wail session (56 windows)

| variant | mean overall | windows ≥ 0.90 (a pass) | windows ≥ 0.95 |
|---|---|---|---|
| saved | 0.874 | 37 | 32 |
| F1 gated | 0.828 | 33 | 28 |
| F1 naive | 0.713 | 8 | 2 |
| F3 | 0.862 | 35 | 29 |
| F1 gated + F3 | 0.817 | 30 | 26 |

Wail (a), analysed 2026-10-06: saved 0.878 (great), F1 gated 0.638 (fair), F1 naive 0.468 (try-again), F3 0.854 (great), F1 gated + F3 0.621 (fair); DTW precision 0.64

Wail (b): saved 0.934 (great), F1 gated 0.879 (great), F1 naive 0.679 (fair), F3 0.920 (great), F1 gated + F3 0.866 (great); DTW precision 0.80
