# Physics-tool investigation (2026-06-12)

Question: should a real billiards physics engine be integrated to make the
cue-ball model more realistic, and if so, which one and how?

Conclusion up front: **keep the analytic TypeScript model in the solver, use
pooltool as an offline validation oracle when higher fidelity is needed.**
The solver's inner loop evaluates thousands of candidate routes through a
landing-spread quadrature and memoized onward-control zones — it needs
closed-form math, not time-stepped simulation (this is ADR-0001's reasoning,
and it held up here: the 30-degree-rule carom path of ADR-0003 turned out to
have a closed form, no engine required).

## Candidates

### pooltool (Python) — recommended as an offline oracle

<https://pooltool.readthedocs.io/> · <https://github.com/ekiefl/pooltool>

The reference open-source billiards simulation: event-based (collisions and
state transitions are solved analytically rather than time-stepped, so there
is no integration error), with peer-reviewed ball, cushion and collision
models, and authored in dialogue with Dr. Dave's billiards physics resources
— the same knowledgebase this project's heuristics come from.

- Installs cleanly for the rasterizing Python on this machine:
  `/usr/bin/python3.12 -m pip install pooltool-billiards` (v0.6.0 verified
  available; not currently installed).
- Its `30_degree_rule` example is the source for the ADR-0003 carom-path
  model; our `departureDir` follow direction is algebraically identical to
  its theoretical carom angle `arctan(sinφ·cosφ / (sin²φ + 2/5))`, and
  `SLIDE_ROLL_RATIO = 0.05` matches its cloth defaults (µ_slide 0.2,
  µ_roll 0.01).
- Integration shape: a fixture script (like the existing repro/sweep
  scripts, but in Python) that replays planned shots — cue position, ghost
  ball, shot type mapped to spin state, travel mapped to impact speed — and
  reports carom angles and rest positions for comparison against
  `caromCurve`/`tracePath`. Run on demand or in CI; the solver never calls
  it at runtime.

### tailuge/billiards (TypeScript) — reference for future sidespin work

<https://github.com/tailuge/billiards>

The only mature TypeScript engine found: Han (2005) ball mechanics, Mathavan
(2010) cushion rebound, Alciatore throw, browser/WebGL, well tested. Two
reasons it is not integrated:

- **License**: GPL-3.0 — vendoring its code would relicense this project.
  Reading it as a reference for independently implemented formulas is fine.
- **Shape**: it is a time-stepped game engine; it fits a future "animate the
  shot" feature, not the solver core.

It is the right reference when sidespin rail rebound is tackled — ADR-0001
already keeps `reflect` pluggable for exactly that, and Mathavan's cushion
model (implemented there) is the standard replacement for the mirror law.

### Rejected

- **FastFiz / poolfiz** (C++, AAAI computational-pool tournaments): unmaintained
  for over a decade, WASM build effort not justified given pooltool exists.
- **JS/TS game demos** (8-ball clones, generic physics engines like Rapier or
  Matter.js): generic rigid-body engines do not model cloth slide/roll
  friction regimes or cushion compliance; billiards needs purpose-built
  models.

## Decision record

- Solver realism improvements continue as closed-form physics in
  `src/shots.ts` (see ADR-0003 for the pattern: derive the shape, keep the
  calibrated directions, expose one physical constant).
- Open flags where an oracle comparison would pay off first: the draw carom
  line corresponds to ~5/9 of natural-roll backspin surviving to contact
  (full-spin draw would return much more sharply — 49° vs 26° off the
  tangent at a 30° cut), and `hitDistance` still prices draw with the legacy
  sin²+k²cos² speed share where physics says the slide eats tangent speed
  (5/9 retention). Both are calibration decisions, not bugs: revisit with
  pooltool data if the player flags draw realism.
