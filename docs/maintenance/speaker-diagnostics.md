# Production speaker diagnostics

The application writes one JSON line per received speaker check to its rotating PM2 output file. From the operator workstation, this command reads the last hour across current and rotated logs.

```sh
ssh mankunku 'find /home/deploy/.pm2/logs -type f -mmin -65 \( -name "mankunku-out-*.log" -o -name "mankunku-out-*.log.gz" \) -exec zgrep -hF "\"event\":\"speaker-check\"" {} +' |
  jq -c 'select(.event == "speaker-check" and ((.at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) >= (now - 3600))) |
    {at,version,clientVersion,surface,session,cueNumber,attempt,stage,result,method,reduction,transientReduction,initialFailure}'
```

Group by server version, client version, surface, anonymous session and cue number. A retry shares its cue number. Count a cue as active if either attempt verified. The method is saved calibration, a correction fitted on this cue, or a response learned from earlier verified cues. Reduction and transient reduction are measured in dB during Listen. Use the Settings and practice outcomes to distinguish a missing profile, a rejected sound check, and device changes. The diagnostic-probe result identifies operator delivery checks.

Delivery is best effort and capped at 60 events per minute per network address and 300 total per server process. The measurements are anonymous client reports and provide an advisory view of rollout health. Recordings, phrase names and account identifiers stay out of this feed. Use the optional local recording export when investigating an individual note. Account deletion also attempts to clear the speaker journal from the current browser. If local cleanup fails, Settings asks the user to remove Mankunku’s site data in the browser. Browser site-data removal also works after a rollback. Delete any previously downloaded reports separately.
