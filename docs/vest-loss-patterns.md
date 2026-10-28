# Why you lose — Vest order log, 27–28 Oct 2026

**Sample: 11 closed positions over 2 days.** That is small. Every claim below carries a
confidence label, and the labels are the most important thing in this document:

- **structural** — true regardless of sample size (a fee rate, a position size, whether a stop existed)
- **suggestive** — a real pattern in this data that 11 trades cannot confirm
- **noise-level** — reported only so you know I looked; do not act on it

Verified against the journal: 11 trades, 31 fills, 19 bracket orders, gross **+192.07**,
fees **37.30**, net **+154.76**, 5 winners / 6 losers. All numbers below come from that same parse.

---

## What is actually costing you money

### 1. Your position size is uncontrolled — **structural**, and it is the whole ballgame

On the 5 trades where you set a real stop, the dollar risk you accepted was:

| When | Size | Stop distance | Risk taken | Result |
|---|---|---|---|---|
| 10/28 13:07 | 2.1034 | 10.25 pts | **$21.56** | −26.29 |
| 10/27 15:44 | 1.6153 | 23.92 pts | **$38.63** | −41.43 |
| 10/28 12:46 | 1.2604 | 36.00 pts | **$45.37** | −27.73 |
| 10/28 13:37 | 4.1383 | 11.50 pts | **$47.59** | +123.13 |
| 10/28 13:07 | 3.6607 | 31.64 pts | **$115.84** | −55.42 |

**$21.56 to $115.84 — a 5.4× spread**, mean $53.80. Notional ran $37,431 to $123,876 (3.3×).

This is the mechanism that makes everything else unreadable. Your worst dollar loss
(−55.42) was only **−0.43R** — a small, well-managed move that cost a lot purely because
the position was the second-largest of the sample. Meanwhile a **−1.07R** trade, a full
stop-out, cost just 26.29. You are being punished and rewarded by size, not by whether
you were right.

Fix this one and every other statistic here starts meaning something. Nothing else on
this list matters as much.

### 2. Fees take 19.4% of your gross — **structural**

```
gross profit on winners   +330.70
gross loss on losers      -138.64
gross P&L                 +192.07
fees                       -37.30   <- 19.4% of gross, 11.3% of gross profit
net                       +154.76
```

- **$3.39 per trade**, on an average notional of $67,829 → **0.50 bps per round turn**.
- Fees equal **7.1% of the dollar risk you accept per trade.** You are paying a fourteenth
  of your risk budget to the venue before the trade has an opinion.
- Fees paid on the losers alone: **$18.86**, turning −138.64 gross into **−157.50** net.
- **One trade was a winner that fees turned into a loss**: 10/27 19:55, gross **+0.63**,
  net **−1.26**.

At half the fee rate you net +173.42 (12% better). At zero, +192.07.
You will not get zero — but at 11 trades in 2 days, fee rate is a bigger lever on your
P&L than any entry rule you could change.

### 3. Manual exits are where the losses actually come from — **suggestive** (n=3)

| How it ended | n | Net |
|---|---|---|
| closed by a stop | 7 | **+124.89** |
| take profit | 1 | +64.04 |
| **you closed it by hand** | **3** | **−34.16** |

The two biggest losses of the entire sample were both manual exits: **−55.42** and
**−27.73**, together **−83.15**. That is more than the four stop-outs lost *combined*
(−74.35).

Both manual losers were cut *before* the stop — −0.43R and −0.57R. So the problem is not
that you hold past your stop. It is that the trades you take off by hand are the ones
carrying your largest size, and you take them off while the thesis is still technically
alive. Three trades is not proof. It is the most expensive three-trade pattern here, so
it is worth watching deliberately.

### 4. The result rests on a single trade — **structural** (about this sample)

The 10/28 13:49 short made **+123.13**, which is **80% of your entire net result.**

Without it: **+31.63 over 10 trades.** Your 45.5% win rate and 1.98 profit factor are
descriptions of one good trade, not of a method. Treat every "edge" conclusion from this
dataset — including the ones above — accordingly.

---

## What the data does *not* support

These are hypotheses I tested and the data rejected. A disconfirmed worry is a result.

**Revenge trading — not present.** The opposite, in fact:

| | n | Net | Win rate |
|---|---|---|---|
| re-entered within 5 min of a loss | 6 | **+218.79** | 67% |
| every other trade | 5 | −64.03 | 20% |

Your fastest re-entries after a loss were your *best* trades. (Noise-level split, but it
decisively fails to show the damage pattern people usually look for.)

**You are not letting losers run.** Median hold: **winners 11.5 min, losers 2.5 min**
(means 20.2 vs 6.8). That is the correct asymmetry and the opposite of the classic failure.

**You are not sizing up on bad trades.** Average notional: winners $73,773, losers $62,876.

**Your stops are respected.** The two full stop-outs came in at **−1.01R** and **−1.07R** —
ordinary slippage, not stops being widened or ignored. Average loss across the 4 measurable
losers: **−0.77R**.

---

## One thing to understand about your own data

**"Closed by stop loss" does not mean you lost.** Seven trades ended on a stop and **three
of them were winners** — they were trailing stops you had already dragged into profit.

Only **5 of 11** trades have a genuine stop on record at all. On the other 6 the stop sat
on the *winning* side of your entry by the time it filled, so there is no honest way to say
what you risked, and the journal correctly shows "—" for R rather than inventing a number.

**This is your biggest data-quality gap.** Six of eleven trades cannot be scored. If you
want the R-multiple column to mean anything next month, the original bracket needs to
survive in the log — the importer reads the *first* stop you set, so that part already
works; it is the six trades with no valid original stop that go dark.

Trades where you moved the stop: n=6, net **+182.50**, 67% win. Trades where you did not:
n=5, net −27.74. **Noise-level** — and partly circular, since you only get to trail a stop
on a trade that already went your way.

---

## Everything else, labelled honestly

| Cut | Numbers | Verdict |
|---|---|---|
| Long vs Short | Long n=6 +23.24 (33% win) · Short n=5 +131.52 (60% win) | **noise-level** — and the short bucket is just the one big trade |
| Hour of entry | best 13:00 (+41.42, n=3), 19:00 (+62.78, n=2) | **noise-level** — 1–3 trades per bucket |
| First trade of the day | n=2, **0 for 2**, −69.16 | **noise-level** — two data points. Watch it, do not believe it. |
| Scaling in (`append`) | scaled in n=6 +37.91 · single entry n=5 +116.85 | **noise-level** — the "single entry" figure is the +123 trade |
| Scaling out (`reduce`) | scaled out n=5 +161.40 (80% win) · one exit n=6 −6.64 | **noise-level**, same contamination in reverse |
| Instrument | 11 of 11 **NDX-USD-PERP**, all at **50×** | **structural** — zero diversification, and 50× is what makes the sizing problem in §1 expensive |
| Day | 10/27 +97.63 (6 trades, 50% win) · 10/28 +57.13 (5 trades, 40% win) | — |

### Intraday sequence

```
10/27   #1 -41.43   #2  -5.37   #3 +48.99   #4 +32.67   #5  -1.26   #6 +64.04   (cum +97.63)
10/28   #1 -27.73   #2 +43.44   #3 -26.29   #4 -55.42   #5 +123.13             (cum +57.13)
```

Both days opened red and closed green. On both days you were underwater into the fourth
trade. There is no decay across the session — if anything the late trades carried it. With
two days of data that is a description, not a pattern.

---

## If you change three things

1. **Fix the dollar risk per trade.** Pick one number — say $40 — and let the stop distance
   set the size, not the other way round. This is the only change here that is justified by
   the data rather than suggested by it.
2. **Know your fee rate and count it as part of the risk.** At 7.1% of risk per trade, a
   setup needs to clear its own friction before it is a setup.
3. **Before closing by hand, say out loud what changed.** Your manual exits are your most
   expensive bucket and your largest positions. Three trades is thin — so collect the
   evidence rather than acting on it yet.

Re-run this after ~50 trades. Most of the middle section of this document will change, and
the structural findings in §1, §2 and the instrument row will not.

---

*Generated by `loss-patterns.mjs` and `risk-spread.mjs` in this folder, reading
`vest-order-history-2026_10_28.csv` through the journal's own `src/lib/vest.js`.
Baseline check against the verified aggregates: all agree.*
