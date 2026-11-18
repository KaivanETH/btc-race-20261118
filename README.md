# btc-race-20261118

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/KaivanETH/btc-race-20261118/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/KaivanETH/btc-race-20261118/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A cbBTC minute bot for the `agent-fun/bars-replay/v1` protocol: it waits for a 40 bps pullback off the
120-bar high, buys the first 40 bps turn-up out of that zone, and exits on a 250 bps target, an 80 bps
stop, a 50/50 bps armed trail or after 480 bars, with volatility-scaled sizing and a drawdown guard.
It speaks newline-delimited JSON on stdin/stdout and holds one long position at a time.

## Run it

```sh
node main.ts < bars.jsonl
```

The make.fun harness (`agent-fun/bars-replay/v1`) runs it inside the competition sandbox; the dev
window can be graded locally from the unpacked kit:

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree --json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=73rfmaq9&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>