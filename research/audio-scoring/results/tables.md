## E1 — discrimination (own lick vs transpositions ±1…±5 st, vs other licks at the take's tempo)

| renderer | metric | top1_transposed | mrr_transposed | margin_transposed | top1_other | top1_same_len | margin_other |
|---|---|---|---|---|---|---|---|
| sampled | m1_raw | 0.646 | 0.800 | 0.018 | 0.354 | 0.391 | -0.028 |
| sampled | m2_env | 0.167 | 0.358 | -0.062 | 0.021 | 0.043 | -0.166 |
| sampled | m2_env_at | 0.208 | 0.388 | -0.105 | 0.042 | 0.174 | -0.229 |
| sampled | m3_chroma | 0.979 | 0.990 | 0.382 | 0.854 | 0.848 | 0.171 |
| sampled | m3_chroma_dtw | 1.000 | 1.000 | 0.329 | 0.792 | 0.804 | 0.102 |
| sampled | m4_cqt | 0.979 | 0.990 | 0.287 | 0.854 | 0.870 | 0.190 |
| sampled | m4_cqt_dtw | 0.958 | 0.979 | 0.250 | 0.812 | 0.826 | 0.104 |
| sampled | m5_cover | 1.000 | 1.000 | 0.531 | 0.854 | 0.891 | 0.243 |
| sampled | m5_cover_strict | 1.000 | 1.000 | 0.528 | 0.854 | 0.891 | 0.246 |
| synthetic | m1_raw | 0.625 | 0.796 | 0.017 | 0.417 | 0.478 | -0.014 |
| synthetic | m2_env | 0.000 | 0.220 | -0.017 | 0.021 | 0.043 | -0.177 |
| synthetic | m2_env_at | 0.229 | 0.397 | -0.052 | 0.125 | 0.239 | -0.190 |
| synthetic | m3_chroma | 1.000 | 1.000 | 0.389 | 0.854 | 0.848 | 0.170 |
| synthetic | m3_chroma_dtw | 1.000 | 1.000 | 0.346 | 0.792 | 0.804 | 0.103 |
| synthetic | m4_cqt | 1.000 | 1.000 | 0.275 | 0.875 | 0.870 | 0.179 |
| synthetic | m4_cqt_dtw | 0.958 | 0.979 | 0.236 | 0.708 | 0.761 | 0.091 |
| synthetic | m5_cover | 1.000 | 1.000 | 0.522 | 0.854 | 0.891 | 0.241 |
| synthetic | m5_cover_strict | 1.000 | 1.000 | 0.520 | 0.854 | 0.891 | 0.244 |

## E2 — rank agreement with the per-take truth (Spearman; verified takes, timing-known)

| renderer | metric | spearman_truth | p_truth | spearman_saved | n |
|---|---|---|---|---|---|
| sampled | m1_raw | -0.046 | 0.768 | -0.039 | 44 |
| sampled | m2_env | 0.361 | 0.016 | -0.298 | 44 |
| sampled | m2_env_at | -0.113 | 0.466 | 0.026 | 44 |
| sampled | m3_chroma | 0.579 | 0.000 | 0.021 | 44 |
| sampled | m3_chroma_dtw | 0.514 | 0.000 | 0.061 | 44 |
| sampled | m4_cqt | 0.499 | 0.001 | 0.101 | 44 |
| sampled | m4_cqt_dtw | 0.432 | 0.003 | 0.093 | 44 |
| sampled | m5_cover | 0.594 | 0.000 | -0.085 | 44 |
| sampled | m5_cover_strict | 0.595 | 0.000 | -0.086 | 44 |
| synthetic | m1_raw | 0.019 | 0.901 | -0.011 | 44 |
| synthetic | m2_env | 0.416 | 0.005 | -0.241 | 44 |
| synthetic | m2_env_at | 0.271 | 0.075 | 0.060 | 44 |
| synthetic | m3_chroma | 0.576 | 0.000 | 0.043 | 44 |
| synthetic | m3_chroma_dtw | 0.491 | 0.001 | 0.087 | 44 |
| synthetic | m4_cqt | 0.412 | 0.005 | 0.065 | 44 |
| synthetic | m4_cqt_dtw | 0.335 | 0.026 | 0.041 | 44 |
| synthetic | m5_cover | 0.586 | 0.000 | -0.087 | 44 |
| synthetic | m5_cover_strict | 0.586 | 0.000 | -0.092 | 44 |

## Own-lick scores per take (sampled renderer)

| take | source | case | truth | saved | m1_raw | m2_env_at | m3_chroma | m3_chroma_dtw | m4_cqt | m4_cqt_dtw | m5_cover | m5_cover_strict | m5_precision | m5_recall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 04-14-a3-c4-tenor-noisefloor | ear-training | clean | 1.00 |  | 0.27 | 0.00 | 0.87 | 0.98 | 0.77 | 0.91 | 0.59 | 0.59 | 0.46 | 0.83 |
| 04-14-a4-c5-tenor-sax | ear-training | clean | 1.00 |  | 0.26 | 0.00 | 0.86 | 0.97 | 0.80 | 0.94 | 0.36 | 0.36 | 0.28 | 0.50 |
| 04-19-upper-neighbor-on-root | ear-training | clean | 1.00 |  | 0.26 | 0.00 | 0.81 | 0.97 | 0.77 | 0.94 | 0.79 | 0.79 | 0.72 | 0.87 |
| 05-07-locrian-descent | ear-training | flawed | 0.78 | 0.49 | 0.27 | 0.17 | 0.72 | 0.93 | 0.65 | 0.89 | 0.58 | 0.58 | 0.57 | 0.59 |
| 05-09-fourth-fifth-push | ear-training | clean | 1.00 | 0.68 | 0.11 | 0.11 | 0.86 | 0.98 | 0.69 | 0.80 | 0.86 | 0.86 | 1.00 | 0.76 |
| 05-12-pent-1-2-3-5-half-then-eighths | ear-training | clean | 1.00 | 0.83 | 0.08 | 0.24 | 0.91 | 0.94 | 0.89 | 0.92 | 0.89 | 0.89 | 0.86 | 0.91 |
| 05-12-pent-upper-neighbor-dotted-quart | ear-training | butchered | 1.00 | 0.62 | 0.13 | 0.17 | 0.84 | 0.92 | 0.86 | 0.93 | 0.88 | 0.88 | 0.96 | 0.82 |
| 05-13-pent-5-3-2-1-half-then-eighths | ear-training | clean | 1.00 | 0.80 | 0.13 | 0.22 | 0.89 | 0.98 | 0.86 | 0.95 | 0.89 | 0.89 | 0.81 | 0.99 |
| 05-19-flat-seven-octave | ear-training | clean | 1.00 | 0.66 | 0.17 | 0.18 | 0.96 | 0.96 | 0.84 | 0.89 | 0.92 | 0.92 | 0.91 | 0.93 |
| 05-19-octave-flat-seven-drop | ear-training | clean | 1.00 | 0.79 | 0.13 | 0.01 | 0.88 | 0.98 | 0.73 | 0.85 | 0.91 | 0.91 | 1.00 | 0.83 |
| 05-20-blues-curl-down | ear-training | clean | 1.00 | 0.58 | 0.12 | 0.00 | 0.97 | 0.98 | 0.84 | 0.88 | 0.96 | 0.96 | 0.94 | 0.99 |
| 05-20-blues-curl-up | ear-training | clean | 1.00 | 0.55 | 0.19 | 0.00 | 0.96 | 0.98 | 0.83 | 0.87 | 0.95 | 0.95 | 0.95 | 0.94 |
| 05-22-blues-curl-up | ear-training | clean | 1.00 | 0.65 | 0.30 | 0.00 | 0.93 | 0.97 | 0.92 | 0.96 | 0.92 | 0.92 | 0.97 | 0.87 |
| 05-22-blues-curl-up-b | ear-training | clean | 1.00 | 0.64 | 0.19 | 0.11 | 0.93 | 0.95 | 0.92 | 0.97 | 0.93 | 0.93 | 0.95 | 0.91 |
| 06-21-flat-five-chromatic-up | ear-training | clean | 1.00 | 0.62 | 0.13 | 0.00 | 0.95 | 0.98 | 0.89 | 0.92 | 0.95 | 0.95 | 1.00 | 0.91 |
| 06-24-blues-curl-up | ear-training | clean | 1.00 | 0.63 | 0.23 | 0.15 | 0.92 | 0.98 | 0.87 | 0.94 | 0.92 | 0.92 | 0.99 | 0.86 |
| 06-25-blues-curl-down | ear-training | clean | 1.00 | 0.63 | 0.25 | 0.13 | 0.98 | 0.99 | 0.98 | 0.98 | 0.97 | 0.97 | 0.99 | 0.96 |
| 06-30-fifth-sixth-step | ear-training | clean | 1.00 | 0.52 | 0.13 | 0.00 | 0.94 | 0.96 | 0.84 | 0.91 | 0.94 | 0.94 | 0.96 | 0.92 |
| 07-08-four-to-five | ear-training | flawed | 0.50 | 0.33 | 0.03 | 0.04 | 0.41 | 0.63 | 0.39 | 0.58 | 0.32 | 0.32 | 0.41 | 0.26 |
| 07-14-third-fifth-rise | ear-training | clean | 1.00 | 0.66 | 0.33 | 0.12 | 0.98 | 0.98 | 0.87 | 0.90 | 0.97 | 0.97 | 0.98 | 0.97 |
| 07-23-blue-monk | ear-training | clean | 1.00 |  | 0.27 | 0.24 | 0.79 | 0.95 | 0.77 | 0.93 | 0.79 | 0.79 | 0.90 | 0.71 |
| 07-25-blue-note-step-up | ear-training | clean | 1.00 | 0.65 | 0.21 | 0.00 | 0.94 | 0.95 | 0.87 | 0.91 | 0.92 | 0.92 | 0.89 | 0.96 |
| 07-25-blue-step-down | ear-training | clean | 1.00 | 0.63 | 0.20 | 0.30 | 0.88 | 0.95 | 0.86 | 0.93 | 0.85 | 0.85 | 0.92 | 0.79 |
| 07-25-root-frame | ear-training | butchered | 1.00 | 0.45 | 0.03 | 0.01 | 0.78 | 0.88 | 0.75 | 0.86 | 0.79 | 0.79 | 0.99 | 0.66 |
| 07-28-pent-1-3-2-5 | ear-training | clean | 1.00 | 0.74 | 0.15 | 0.04 | 0.91 | 0.94 | 0.85 | 0.91 | 0.88 | 0.88 | 0.88 | 0.89 |
| 07-28-pent-1-3-2-5-dotted-quarter-eigh | ear-training | butchered | 1.00 | 0.74 | 0.15 | 0.04 | 0.91 | 0.94 | 0.85 | 0.91 | 0.88 | 0.88 | 0.88 | 0.89 |
| 07-29-sixth-octave-lift | ear-training | clean | 1.00 | 0.67 | 0.10 | 0.08 | 0.90 | 0.95 | 0.75 | 0.81 | 0.17 | 0.17 | 0.16 | 0.17 |
| 07-30-climb-to-five | ear-training | clean | 1.00 | 0.72 | 0.25 | 0.03 | 0.93 | 0.97 | 0.88 | 0.93 | 0.93 | 0.93 | 0.98 | 0.89 |
| 08-01-down-to-the-third | ear-training | clean | 1.00 | 0.68 | 0.06 | 0.00 | 0.93 | 0.98 | 0.90 | 0.96 | 0.93 | 0.93 | 0.91 | 0.95 |
| 08-01-flat-five-chromatic-down | ear-training | clean | 1.00 | 0.65 | 0.07 | 0.45 | 0.96 | 0.97 | 0.84 | 0.86 | 0.93 | 0.93 | 0.95 | 0.92 |
| 08-10-pent-1-2-3-5-eighth-run-hold | ear-training | flawed | 0.75 | 0.52 | 0.18 | 0.28 | 0.88 | 0.92 | 0.88 | 0.91 | 0.86 | 0.86 | 0.91 | 0.81 |
| 08-11-blue-note-climb | ear-training | clean | 1.00 | 0.67 | 0.09 | 0.49 | 0.83 | 0.94 | 0.84 | 0.96 | 0.89 | 0.89 | 0.98 | 0.82 |
| 08-11-curl-to-the-floor | ear-training | clean | 1.00 | 0.75 | 0.25 | 0.26 | 0.91 | 0.94 | 0.88 | 0.92 | 0.86 | 0.86 | 0.90 | 0.82 |
| 08-13-blue-note-roll-off | ear-training | clean | 1.00 | 0.71 | 0.26 | 0.27 | 0.95 | 0.96 | 0.95 | 0.96 | 0.93 | 0.93 | 0.98 | 0.88 |
| 08-13-slide-back-down | ear-training | clean | 1.00 | 0.75 | 0.27 | 0.00 | 0.92 | 0.98 | 0.90 | 0.96 | 0.91 | 0.91 | 0.91 | 0.91 |
| 08-18-blues-curl-up | ear-training | clean | 1.00 | 0.54 | 0.16 | 0.38 | 0.94 | 0.99 | 0.93 | 0.98 | 0.94 | 0.94 | 0.97 | 0.92 |
| 09-03-tonic-turn-with-leading-tone | ear-training | butchered | 1.00 | 0.42 | 0.09 | 0.16 | 0.88 | 0.96 | 0.79 | 0.88 | 0.86 | 0.86 | 0.93 | 0.81 |
| 09-09-blue-note-drop | ear-training | butchered | 1.00 | 0.71 | 0.27 | 0.48 | 0.96 | 0.97 | 0.90 | 0.92 | 0.94 | 0.94 | 0.92 | 0.96 |
| 09-09-climb-to-five | ear-training | clean | 1.00 | 0.82 | 0.20 | 0.52 | 0.96 | 0.98 | 0.90 | 0.95 | 0.92 | 0.92 | 0.92 | 0.92 |
| 09-12-four-to-five | ear-training | clean | 0.75 | 0.73 | 0.15 | 0.33 | 0.86 | 0.97 | 0.82 | 0.95 | 0.87 | 0.87 | 0.96 | 0.79 |
| 09-16-sharp-9-flat-9-dom | lick-practice | flawed | 0.78 | 0.74 | 0.20 | 0.27 | 0.85 | 0.89 | 0.78 | 0.84 | 0.73 | 0.68 | 0.72 | 0.74 |
| 09-18-blues-curl-up | ear-training | clean | 1.00 | 0.57 | 0.11 | 0.32 | 0.92 | 0.96 | 0.92 | 0.96 | 0.94 | 0.94 | 0.98 | 0.91 |
| 10-01-enclosure-from-above-dotted-quar | ear-training | clean | 1.00 | 0.99 | 0.24 | 0.15 | 0.87 | 0.97 | 0.84 | 0.95 | 0.85 | 0.85 | 0.89 | 0.81 |
| 10-03-four-to-five | ear-training | flawed | 0.75 | 0.49 | 0.35 | 0.22 | 0.85 | 0.98 | 0.77 | 0.89 | 0.89 | 0.89 | 0.93 | 0.84 |
| 10-03-honeysuckle-rose | lick-practice | butchered | 0.80 | 0.59 | 0.26 | 0.08 | 0.88 | 0.96 | 0.83 | 0.93 | 0.78 | 0.78 | 0.73 | 0.83 |
| 10-03-honeysuckle-rose-b | lick-practice | butchered | 0.60 | 0.49 | 0.30 | 0.51 | 0.86 | 0.92 | 0.80 | 0.89 | 0.73 | 0.57 | 0.78 | 0.68 |
| 10-06-fats-navarro-wail-a | lick-practice | inflated | 0.61 | 0.88 | 0.03 | 0.03 | 0.61 | 0.74 | 0.46 | 0.59 | 0.51 | 0.46 | 0.52 | 0.50 |
| 10-06-fats-navarro-wail-b | lick-practice | inflated | 0.79 | 0.93 | 0.04 | 0.10 | 0.75 | 0.86 | 0.65 | 0.73 | 0.69 | 0.54 | 0.74 | 0.65 |

## E3 — named cases (sampled renderer): value and percentile among clean verified takes

| take | case | m1_raw | m2_env_at | m3_chroma | m3_chroma_dtw | m4_cqt | m4_cqt_dtw | m5_cover | m5_cover_strict |
|---|---|---|---|---|---|---|---|---|---|
| 05-07-locrian-descent | flawed | 0.90 | 0.60 | 0.00 | 0.00 | 0.00 | 0.23 | 0.03 | 0.03 |
| 05-12-pent-upper-neighbor-dotted-quart | butchered | 0.33 | 0.60 | 0.07 | 0.00 | 0.40 | 0.53 | 0.23 | 0.23 |
| 07-08-four-to-five | flawed | 0.00 | 0.33 | 0.00 | 0.00 | 0.00 | 0.00 | 0.03 | 0.03 |
| 07-25-root-frame | butchered | 0.00 | 0.30 | 0.00 | 0.00 | 0.07 | 0.13 | 0.03 | 0.03 |
| 07-28-pent-1-3-2-5-dotted-quarter-eigh | butchered | 0.40 | 0.33 | 0.33 | 0.07 | 0.37 | 0.33 | 0.20 | 0.20 |
| 08-10-pent-1-2-3-5-eighth-run-hold | flawed | 0.50 | 0.80 | 0.20 | 0.00 | 0.63 | 0.37 | 0.13 | 0.13 |
| 09-03-tonic-turn-with-leading-tone | butchered | 0.13 | 0.60 | 0.20 | 0.33 | 0.13 | 0.20 | 0.20 | 0.20 |
| 09-09-blue-note-drop | butchered | 0.90 | 0.93 | 0.87 | 0.47 | 0.77 | 0.40 | 0.73 | 0.73 |
| 09-16-sharp-9-flat-9-dom | flawed | 0.63 | 0.77 | 0.07 | 0.00 | 0.13 | 0.07 | 0.03 | 0.03 |
| 10-03-four-to-five | flawed | 1.00 | 0.63 | 0.07 | 0.63 | 0.13 | 0.23 | 0.23 | 0.23 |
| 10-03-honeysuckle-rose | butchered | 0.87 | 0.40 | 0.20 | 0.33 | 0.13 | 0.53 | 0.03 | 0.03 |
| 10-03-honeysuckle-rose-b | butchered | 0.93 | 0.97 | 0.07 | 0.00 | 0.13 | 0.23 | 0.03 | 0.03 |
| 10-06-fats-navarro-wail-a | inflated | 0.00 | 0.30 | 0.00 | 0.00 | 0.00 | 0.00 | 0.03 | 0.03 |
| 10-06-fats-navarro-wail-b | inflated | 0.00 | 0.40 | 0.00 | 0.00 | 0.00 | 0.00 | 0.03 | 0.03 |

## E4 — perturbations of the ten cleanest takes: mean drop (min drop) per metric

| metric | extra_after | extra_inside | note_dropped | note_late150ms | pitch+1st | stretch+5% | stretch-5% |
|---|---|---|---|---|---|---|---|
| m1_raw | 0.012 | 0.023 | 0.030 | -0.014 | 0.052 | 0.009 | 0.004 |
| m2_env | 0.059 | 0.032 | -0.014 | 0.008 | 0.005 | 0.061 | 0.138 |
| m2_env_at | 0.084 | 0.085 | 0.099 | -0.026 | 0.028 | 0.077 | -0.033 |
| m3_chroma | 0.171 | 0.157 | 0.186 | 0.038 | 0.163 | 0.005 | 0.030 |
| m3_chroma_dtw | 0.067 | 0.152 | 0.141 | 0.009 | 0.135 | 0.005 | -0.000 |
| m4_cqt | 0.168 | 0.149 | 0.172 | 0.042 | 0.106 | 0.005 | 0.032 |
| m4_cqt_dtw | 0.065 | 0.135 | 0.129 | 0.010 | 0.087 | 0.006 | 0.002 |
| m5_cover | 0.109 | 0.187 | 0.142 | 0.024 | 0.254 | -0.001 | 0.022 |
| m5_cover_strict | 0.109 | 0.187 | 0.142 | 0.024 | 0.254 | -0.001 | 0.022 |

Minimum drop (worst take):

| metric | extra_after | extra_inside | note_dropped | note_late150ms | pitch+1st | stretch+5% | stretch-5% |
|---|---|---|---|---|---|---|---|
| m1_raw | -0.000 | -0.030 | -0.046 | -0.077 | -0.026 | -0.033 | -0.041 |
| m2_env | 0.011 | -0.072 | -0.084 | -0.169 | -0.023 | 0.010 | -0.046 |
| m2_env_at | -0.021 | 0.000 | -0.059 | -0.456 | -0.037 | -0.149 | -0.380 |
| m3_chroma | 0.145 | 0.106 | 0.048 | 0.013 | 0.039 | -0.019 | 0.004 |
| m3_chroma_dtw | -0.000 | 0.099 | 0.012 | -0.011 | 0.031 | -0.007 | -0.012 |
| m4_cqt | 0.144 | 0.096 | 0.055 | 0.007 | 0.034 | -0.025 | -0.031 |
| m4_cqt_dtw | -0.000 | 0.077 | -0.007 | -0.016 | 0.030 | -0.046 | -0.062 |
| m5_cover | 0.085 | 0.109 | 0.033 | 0.006 | 0.088 | -0.030 | -0.011 |
| m5_cover_strict | 0.085 | 0.109 | 0.033 | 0.006 | 0.088 | -0.030 | -0.011 |