# 9-Ball Pattern Solver

A pattern-play trainer: generates random 9-ball end-game layouts with ball in
hand, solves for the run-out pattern with the highest run-out
probability, and draws it step by step — pie-shaped position zones, natural
angles, coming into the line of the shot.

Built on the principles in Dr. Dave Alciatore's *Pattern Play Principles*
(Billiards Digest, Feb 2021) and Florian Kohler's *Pattern Play* (PoolDawg
Academy). Domain language lives in [CONTEXT.md](./CONTEXT.md); design
decisions are recorded in [docs/adr/](./docs/adr/). The agent-facing
architecture and solver-parameter map lives in
[docs/solver-guide.md](./docs/solver-guide.md).

## Run

```sh
npm install
npm run dev     # local app at the printed URL
npm test        # unit tests + golden principle scenarios
npm run build   # type-check + production bundle
```

The current layout's seed is kept in the URL hash (`#s=12345`), so layouts
are shareable and reproducible.

## Install on Android (offline PWA, no hosting)

The app is an installable, fully-offline PWA: once installed, its service worker
serves everything from cache, so it needs no network — local or public. The only
trick is that a browser will only *install* it from a secure context, which we
reach locally instead of by hosting it. See
[docs/adr/0007](./docs/adr/0007-installable-offline-pwa-no-hosting.md) for why.

`localhost` is a secure context, and `adb reverse` maps the phone's localhost to
your machine — so no HTTPS or certificate is needed.

```sh
npm run build
npm run preview                       # serves dist/ at http://localhost:4173
adb reverse tcp:4173 tcp:4173         # phone (USB, debugging on) → your laptop
```

On the phone, open `http://localhost:4173` in Chrome → menu → **Install app**.
After it installs you can unplug; it runs full-screen and offline from the home
screen. To ship a new version: rebuild, re-run the two commands above, reopen the
installed app — the `autoUpdate` service worker swaps its cache on next launch.

## How it works

- **Generator** (`src/generator.ts`) — rejection-samples object-ball
  positions and accepts a layout only if the solver finds a complete pattern
  (solver-validated generation).
- **Solver** (`src/solver.ts`) — beam search over ball-in-hand placement,
  pocket choice, and routes (stop / follow / stun / touch of low / draw,
  mirror-law rails). The run-out probability compounds pot probability with
  expected next-position value over deterministic speed and direction error
  samples. Zone size, entering along the line vs. across it, cushion braking,
  scratch risk, and shot-type reliability influence the score through that
  expectation. Tuning ownership is documented in
  [docs/solver-guide.md](./docs/solver-guide.md).
- **Position zones** (`src/zone.ts`) — a zone keeps only cue-ball positions
  from which the pot is on AND the cue ball can still be moved toward the
  following ball's zone (onward control). Awkward near-rail positions and
  cramped positions near the object ball are filtered by source-owned
  thresholds; the best non-chosen pocket's zone is drawn fainter as a
  second-choice expansion.
- **Stepping** — step 0 shows the bare layout (no cue ball) so you can
  visualize your own pattern before *Next* reveals the solver's placement,
  overview, and shots.
- **Renderer** (`src/render.ts`) — pure SVG table diagrams in the style of
  the source articles.

Ball count is a parameter end-to-end: the generator, solver, URL hash, and UI
all pass it through rather than hard-coding one rack size.

Visual snapshots for review: `npx vite-node scripts/snapshot.ts` writes every
step of a seeded puzzle to `/tmp/pps-snapshots/`.
