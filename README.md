# 9-Ball Pattern Solver

A pattern-play trainer: generates random 9-ball end-game layouts (3 balls
left, ball in hand), solves for the run-out pattern with the highest run-out
probability, and draws it step by step — pie-shaped position zones, natural
angles, coming into the line of the shot.

Built on the principles in Dr. Dave Alciatore's *Pattern Play Principles*
(Billiards Digest, Feb 2021) and Florian Kohler's *Pattern Play* (PoolDawg
Academy). Domain language lives in [CONTEXT.md](./CONTEXT.md); the two
load-bearing design decisions are recorded in [docs/adr/](./docs/adr/).

## Run

```sh
npm install
npm run dev     # local app at the printed URL
npm test        # unit tests + golden principle scenarios
npm run build   # type-check + production bundle
```

The current layout's seed is kept in the URL hash (`#s=12345`), so layouts
are shareable and reproducible.

## How it works

- **Generator** (`src/generator.ts`) — rejection-samples object-ball
  positions and accepts a layout only if the solver finds a complete pattern
  (solver-validated generation).
- **Solver** (`src/solver.ts`) — beam search over ball-in-hand placement,
  pocket choice, and routes (stop / follow / stun / touch of low / draw,
  mirror-law rails). Score = P(pot) × Π E[next-shot pot] over a deterministic
  quadrature of speed and direction errors, under a fixed intermediate skill
  profile (`src/skill.ts`): max cut 60° (beyond a quarter-ball hit ~48° only
  within ~1 m), full draw penalized past ~1 m of cue-to-ball distance,
  routes that skim a pocket mouth penalized for scratch risk, and no route
  may travel less than pocket pace leaves the cue ball with. Zone size,
  entering along the line vs. across it, and cushion braking all influence
  the score through that expectation — no hand-tuned weights.
- **Position zones** (`src/zone.ts`) — a zone keeps only cue-ball positions
  from which the pot is on AND the cue ball can still be moved toward the
  following ball's zone (onward control). A ~20 cm band along the rails is
  excluded from the drawn zone unless the zone exists nowhere else, and the
  zone keeps ~25 cm clearance from the object ball itself; the best
  non-chosen pocket's zone is drawn fainter as a second-choice expansion.
- **Stepping** — step 0 shows the bare layout (no cue ball) so you can
  visualize your own pattern before *Next* reveals the solver's placement,
  overview, and shots.
- **Renderer** (`src/render.ts`) — pure SVG table diagrams in the style of
  the source articles.

Ball count is a parameter end-to-end (the generator/solver handle N balls);
the UI pins it to 3 until the verification gate in CONTEXT.md is widened.

Visual snapshots for review: `npx vite-node scripts/snapshot.ts` writes every
step of a seeded puzzle to `/tmp/pps-snapshots/`.
