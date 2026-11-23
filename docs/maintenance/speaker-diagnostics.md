# Production speaker diagnostics

The application writes one JSON line per received speaker check to its rotating PM2 output file. From the operator workstation, read recent events with:

```sh
ssh mankunku 'find /home/deploy/.pm2/logs -name "mankunku-out-*.log" -mmin -60 -exec grep -hF "\"event\":\"speaker-check\"" {} +' | jq -c '{at,surface,session,cueNumber,attempt,result,method,reduction,initialFailure}'
```

Group by server version, client version, surface, anonymous session and cue number. A retry shares its cue number. Count a cue as active if either attempt verified. The method is saved calibration, a correction fitted on this cue, or a response learned from earlier verified cues. Reduction and transient reduction are measured in dB during Listen. Use the Settings and practice outcomes to distinguish a missing profile, a rejected sound check, and device changes. The diagnostic-probe result identifies operator delivery checks.

Delivery is best effort and capped at 300 events per minute per server process. Recordings, phrase names and account identifiers stay out of this feed. Use the optional local recording export when investigating an individual note.
