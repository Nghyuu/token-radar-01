# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Nghyuu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Nghyuu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-2) ranks every pre-token protocol in a sealed DefiLlama snapshot by what its
launch would be worth, and shows how to farm each one. The board covers all 40 watchlist
protocols plus every rankable pre-token protocol below the floor — 226 rows in all.

The value model is calibrated from the snapshot itself: each category's multiple is the median
market-cap-per-TVL of that category's live-token protocols, shrunk toward the global median.
Implied value is TVL × category multiple × growth × maturity × breadth, where growth is the
seven-day TVL change, maturity is how long the protocol has run with no token, and breadth is
how many chains it runs on. No protocol name is special-cased.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or later, standard library only. The program reads `/input/snapshot.json`, writes the
ranked board to `/output/board.json`, the dashboard data to `/output/data.js`, copies
`dashboard/` and `screenshots/` to `/output`, and writes `/output/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
