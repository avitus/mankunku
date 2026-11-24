# Production speaker diagnostics

The application writes one JSON line per received speaker check to its rotating PM2 output file. From the operator workstation, this command reads the last hour across current and rotated logs.

```sh
ssh mankunku 'find /home/deploy/.pm2/logs -type f -mmin -65 \( -name "mankunku-out-*.log" -o -name "mankunku-out-*.log.gz" \) -exec zgrep -hF "\"event\":\"speaker-check\"" {} +' |
  jq -c 'select(.event == "speaker-check" and ((.at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) >= (now - 3600))) |
    {at,version,clientVersion,surface,session,cueNumber,attempt,closingStartSeconds,stage,result,method,reduction,transientReduction,initialFailure}'
```

Group by server version, client version, surface, anonymous session and cue number. A second capture shares its cue number. A nonzero `closingStartSeconds` identifies a check that also tried a later section of the same recording. An active result on that row passed verification on both the ending and the opening. Count a cue as active if either attempt verified. `calibrated-gain` means that the original calibration level passed after the level fitted on the opening of the cue failed. The other methods are saved calibration, a correction fitted on this cue, or a response learned from earlier verified cues. Reduction and transient reduction are measured in dB during Listen. Use the Settings and practice outcomes to distinguish a missing profile, a rejected sound check, and device changes. The diagnostic-probe result identifies operator delivery checks.

Delivery is best effort and capped at 60 events per minute per network address and 300 total per server process. The measurements are anonymous client reports and provide an advisory view of rollout health. Recordings, phrase names and account identifiers stay out of this feed. Use the optional local recording export when investigating an individual note. Account deletion also attempts to clear the speaker journal from the current browser. If local cleanup fails, Settings asks the user to remove Mankunku’s site data in the browser. Browser site-data removal also works after a rollback. Delete any previously downloaded reports separately.
