# Weimar Jazz Database attribution

Mankunku's lick-naming feature uses a compact index derived from the
**Weimar Jazz Database** (WJazzD), a collection of transcribed jazz solos
maintained by the Jazzomat Research Project at the Hochschule für Musik
Franz Liszt Weimar.

- Project page: <https://jazzomat.hfm-weimar.de/>
- Database downloads: <https://jazzomat.hfm-weimar.de/dbformat/dbdownload.html>
- Citation: Pfleiderer, M.; Frieler, K.; Abeßer, J.; Zaddach, W.-G.; Burkhart, B. (Eds.), *Inside the Jazzomat — New Perspectives for Jazz Research*. Schott Campus, 2017.

## License

The Weimar Jazz Database is licensed under **Creative Commons
Attribution-NonCommercial-ShareAlike 4.0 International (CC-BY-NC-SA 4.0)**.
Full license text: <https://creativecommons.org/licenses/by-nc-sa/4.0/>.

The derived index file at `src/lib/matching/data/wjazzd-index.json` is a
derivative work and inherits the same license. Implications:

- **Attribution.** Every match-suggestion response from `/api/lick-match`
  includes the source performer + title so WJazzD credit follows the data
  wherever it surfaces in the UI.
- **Non-commercial.** This index cannot be redistributed as part of a
  commercial offering. Confirm Mankunku's status as non-commercial before
  shipping the index to end users; if the app is ever distributed
  commercially, the index must be removed or the WJazzD rights-holders
  contacted for a different license.
- **Share-alike.** Any further modification of the index must also be
  released under CC-BY-NC-SA.

## Rebuilding the index

The raw WJazzD SQLite file is intentionally **not committed** to this
repo. To regenerate `wjazzd-index.json`:

1. Download `wjazzd.db` from the Jazzomat site above.
2. Place it at `data/raw/wjazzd.db` (the path is gitignored).
3. Install the sqlite driver ephemerally: `npm i --no-save better-sqlite3`
4. Run: `node scripts/build-wjazzd-index.mjs`
5. Commit the updated `src/lib/matching/data/wjazzd-index.json`.

The rebuild is idempotent and only needs to happen when WJazzD itself
ships a new release or when the preprocessing script changes.
