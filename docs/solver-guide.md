# Solver Guide For Agents

This guide is the durable map of how the application works and where solver
decision parameters live. It is written for AI agents first, but should stay
useful to human maintainers.

Do not copy current numeric defaults into this file. Defaults drift as the
model is calibrated. Link to the owning source module and describe what each
parameter controls instead.

## Keep This Updated

When changing solver behavior, update this guide in the same change if you:

- add, remove, rename, or reinterpret a parameter that affects solver choices;
- move a decision rule between modules;
- change the meaning of a score, gate, zone, route, or generated layout;
- add a new player profile, shot type, route type, or generation mode.

Use [CONTEXT.md](../CONTEXT.md) for domain vocabulary and design rationale.
Use ADRs in [docs/adr/](./adr/) for decisions that should be preserved over
time. Use this file as the index from behavior to source.

## Application Flow

The app is a browser-based 9-ball pattern-play trainer. It generates a late
rack layout, solves a complete run-out pattern, and renders step-by-step SVG
diagrams.

The runtime flow is:

1. [src/main.ts](../src/main.ts) reads the URL hash, selected ball count, and
   fixed skill profile.
2. [src/generator.ts](../src/generator.ts) rejection-samples object-ball
   layouts and calls the solver. A generated puzzle is accepted only after a
   complete pattern is found, with fallback to the best sampled pattern.
3. [src/solver.ts](../src/solver.ts) solves the forced 9-ball order. It does
   not choose ball order; it chooses ball-in-hand placement, pocket choices,
   shot types, routes, and position-zone landings.
4. [src/value.ts](../src/value.ts) builds backward value surfaces from the
   last ball toward the first, so earlier zones already encode requirements
   of the rest of the rack.
5. [src/seed.ts](../src/seed.ts) creates opening ball-in-hand candidate nodes.
6. [src/route.ts](../src/route.ts) expands each node by finding cue-ball
   routes into the next ball's gated position zone.
7. [src/solver.ts](../src/solver.ts) beam-prunes candidates, evaluates landing
   uncertainty, finalizes the best pattern, stamps each shot's resolved
   Position Zone (`resolveShotZones`, so the renderer draws the same zone the
   route was scored against), and asks [src/explain.ts](../src/explain.ts) for
   human-readable shot text.
8. [src/scene.ts](../src/scene.ts) builds render scenes for the layout,
   overview, and each shot. [src/render.ts](../src/render.ts) renders pure
   SVG.

The fixed profile used by the app is exported from
[src/skill.ts](../src/skill.ts) and imported by [src/main.ts](../src/main.ts).
The solver APIs accept a `SkillProfile`, so future skill sliders should be
profile swaps rather than conditional logic scattered through the solver.

## Solver Model

The solver score is a run-out probability. Each shot contributes the
probability of potting the current ball and, except for the final ball, the
expected value of reaching a usable position zone for the next ball. The
forward beam search ranks candidates by this probability plus a private
sort-key tie-break for simpler and better-aligned routes.

Position zones are not merely places where the next ball is pottable. They
are cue-ball positions where the next ball can be potted and the cue ball can
still be moved toward what the rest of the rack requires. The drawn zones and
route search share the same backward-gated value surfaces.

Routes are idealized cue-ball paths. The available shot types are defined in
[src/shots.ts](../src/shots.ts). Paths use the project's analytic cue-ball
model: shot type fixes the post-contact departure behavior, travel is the
speed parameter, cushions use mirror-law rebound, and follow/draw paths may
include a curved slide phase before natural roll.

The opening shot is special because the player has ball in hand. The solver
can choose exact cue-ball placement, including placements engineered so the
first cue-ball route enters the next shot line.

## Decision Parameters

This section inventories parameters that affect solver decisions. Keep the
names and ownership current, but keep actual defaults in source only.

### Player Skill Profile

Authoritative source: `SkillProfile` and `INTERMEDIATE` in
[src/skill.ts](../src/skill.ts).

These fields define the assumed player and affect pot probabilities, route
reliability, landing spread, and zone feasibility:

- `aimSigma`: base cue-aim direction error.
- `throwSigma`: object-ball direction noise at contact, independent of
  cue-ball distance.
- `maxCut`: hard maximum makeable cut.
- `comfortCut`: cut threshold after which long cue-to-object distances are
  rejected.
- `cutSweetMax` and `cutGrowth`: gradual difficulty growth for thinner cuts.
- `thinCutMaxDist`: distance gate for very thin cuts and distance scale for
  draw difficulty.
- `speedSigma`: shot-type relative distance error.
- `speedSigmaFloor`: minimum landing-distance uncertainty by shot type.
- `dirSigma`: shot-type departure-direction uncertainty.
- `railDirSigma`: added direction uncertainty per rail.
- `drawDistFactor`: long-shot draw difficulty multiplier.
- `drawShortEase`: short-shot draw reliability easing.
- `stopDrift`: distance-dependent drift for stop shots.
- `railBrake`: cushion damping of distance error.
- `railNoise`: extra distance noise per cushion.
- `straightFollowMultiRailCut` and `straightFollowMultiRailReliability`:
  execution cost for multi-rail follow from very straight cuts.
- `positionTravelScale`: discount for cue-ball travel forced by the pot.
- `typeReliability`: clean execution reliability by shot type.
- `drawRailRoom`: first-rail room needed for draw and touch-of-low.
- `handDirEase`: direction-error reduction for routes played from ball in hand.
- `hitComfort` and `hitMax`: hit-power comfort range and hard ceiling.

The quadrature samples in [src/skill.ts](../src/skill.ts) also affect solver
decisions: `DIST_NODES`, `DIST_WEIGHTS`, `DIR_NODES`, and `DIR_WEIGHTS`.
They define the deterministic landing-error integration used when evaluating
position routes.

### Table And Pocket Geometry

Authoritative source: [src/table.ts](../src/table.ts).

These constants define the world in which every shot, zone, collision check,
and generated layout is interpreted:

- `TABLE_W`, `TABLE_H`, and `BALL_R`: table and ball dimensions.
- `POCKETS`: pocket targets, facings, effective widths, acceptance cones,
  capture radii, and labels.
- `ACCEPTANCE_NEAR` and `JAW_RANGE`: near-pocket widening of acceptance.
- `MIN_X`, `MAX_X`, `MIN_Y`, and `MAX_Y`: legal ball-center bounds.

Changing these values changes pot probability, scratch checks, route tracing,
zone construction, and layout generation.

### Shot Physics

Authoritative source: [src/shots.ts](../src/shots.ts).

These parameters define the idealized cue-ball physics used by both route
search and zone onward-control checks:

- `ShotType`: the set of available cue-ball actions.
- `LOW_TOUCH`: how far the touch-of-low action sits between stun and draw.
- `POCKET_PACE`: minimum object-ball pace assumed by `minCueTravel`.
- `SLIDE_ROLL_RATIO`: slide-to-roll friction ratio for curved carom paths.
- `CURVE_SEGS`: polyline resolution for the slide-phase curve.
- `rollShare`, `signedRollShare`, `minCueTravel`, and `hitDistance`: not
  plain constants, but decision formulas that translate shot type, cut angle,
  ball-to-pocket distance, and travel into forced motion and hit power.
- `tracePath`: rebound, collision, scratch, and rail-count semantics.

When adding a shot type, update `ShotType`, departure geometry, skill-profile
records, route generation, explanation text, and tests together.

### Position Zones

Authoritative source: [src/zone.ts](../src/zone.ts).

These parameters shape whether a cue-ball position is usable for the next
shot and what window is drawn:

- `RAIL_MARGIN` and `RAIL_AWAY_GATE`: rail-band comfort and exclusion rules.
- `BALL_MARGIN_HARD` and `BALL_MARGIN`: clearance from the next object ball.
- `proximity` with `POSITION_HALF`, `POSITION_DIAG`, and `POSITION_FLOOR`: a
  closeness preference on the cue-to-object distance of the shot being valued.
  Flat (full value) inside half the long rail, then falls progressively to
  `POSITION_FLOOR` at the far diagonal. Pot probability saturates for easy
  balls, so without this the value is blind to distance-to-the-next-ball and
  the solver will leave a dead-straight, full-table leave. Because it rides on
  `zoneValue` it shapes the drawn windows, the backward value surfaces, and
  every onward-control reading alike — devaluing a leave whose only cheap
  onward route stays full-table from the next ball.
- `CONTROL_SAT`: value threshold where onward control saturates.
- `CONTROL_STEP` and `CONTROL_RANGE`: scan resolution and reach for onward
  control exits.
- `STRAIGHT_CUT`: threshold where stop-shot onward control is considered.
- `ZONE_RELATIVE` and `ZONE_FLOOR`: quality bar for a point to count inside a
  zone.
- `zonePeak`, `zoneBar`, and `zonePolygons`: formulas that define the
  peak-value anchor, display threshold, and drawable pie shapes.
- `cachedOnwardControl`: memoization quantization for onward-control values.

Zone logic affects both scoring and rendering. The route search and displayed
windows should keep using the same gated `ZoneContext` semantics.

### Backward Value Surfaces

Authoritative source: [src/value.ts](../src/value.ts).

These parameters and formulas control the backward pass from the last ball:

- `GRID_STEP`: raster pitch for value surfaces.
- `buildSurfaces`: builds one surface per future ball, normalized to its own
  peak.
- `gateFor`: selects the surface used to gate the previous ball's zone.
- `surfacesForLayout`: per-layout cache shared by solver and renderer.
- `zoneInputsForBall`: the single source of the rule "a ball's Position Zone
  uses obstacles = the balls after it and gate = the next ball's value
  surface". Read by the backward pass, the ball-in-hand seeds, the route
  search, the renderer, and the explanation pass, so the obstacle slice and
  gate index cannot drift between the window the search scores and the one
  drawn.

These surfaces are feasibility gates, not final pattern rankers. They should
filter dead futures without replacing the route-level expected-value math.

### Ball-In-Hand Seeds

Authoritative source: [src/seed.ts](../src/seed.ts).

These parameters define the first layer of the beam search:

- `ALIGN_MAX_DEG` and `ALIGN_MAX_OFF`: criteria for carom paths that count as
  aligned with the next shot line.
- `GRID_SEEDS_PER_POCKET`, `RAIL_SIDE_SEEDS_PER_POCKET`, and
  `ALIGNED_SEEDS_PER_POCKET`: per-pocket seed caps.
- The opening angle grid and distance grid inside `initialNodes`: standard
  ball-in-hand placement samples.
- `railSideSeed`: extra near-rail-side opening placements.
- `alignedCuts`: solved cut-angle placements that make the first cue-ball
  route run along a future shot line.
- The minimum starting `zoneValue` check inside `initialNodes`: rejects weak
  opening placements before the beam search starts.

Seed changes can remove entire classes of first-shot patterns before route
search ever sees them.

### Route Search

Authoritative source: [src/route.ts](../src/route.ts).

These parameters control route enumeration, candidate pruning, scratch risk,
and position expectation:

- `MAX_ROUTE`: maximum cue-ball travel explored for a route.
- `WALK_STEP`: sampling interval along route paths.
- `ZONE_VMIN`: minimum effective value while identifying usable path runs.
- `SIMPLE_ROUTE_MAX_TRAVEL`: maximum no-rail stop/stun/low/draw travel that
  can count as the simple baseline when pricing redundant long rail-follow.
- `redundantLongFollowFactor`: penalizes a long rail-follow when a comparable
  short no-rail route reaches about the same window. The short route also
  stays inside the position window the whole way, while the rail follow loops
  outside it, so this also encodes the "stay in the window" preference. Gated
  on closeness: a long follow that is the only way to a far window keeps its
  full value. Its travel ramp controls how fast the in-window route wins.
- `LANDING_RAIL_INSET`: strict-pass clearance from awkward rail-band landings.
- `SCRATCH_MARGIN`: near-pocket scratch-risk margin.
- `zoneTargets`: which pockets are eligible for the next ball.
- `routeCandidates`: stop/follow/stun/low/draw candidate enumeration,
  effective-value bars, interval selection, deep-end landing candidates,
  simple-route comparison for redundant rail-follow, and route ease.
- `expectedNextPot`: landing-spread quadrature used for final position value.
- `pocketRisk`: deterministic scratch-risk penalty for paths near pocket
  mouths.
- `clearanceRisk`: deterministic penalty for a cue-ball path that threads
  close past a ball it is not playing position for (the object-ball twin of
  `pocketRisk`). The landing quadrature samples direction too coarsely to see
  a centerline grazing a ball, so this prices the lane explicitly. Owns
  `BLOCK_MARGIN` (daylight a lane needs to read as open) and `BLOCK_FLOOR`
  (worst penalty at dead contact). Applied in the beam alongside `pocketRisk`.
  `BLOCK_FLOOR` is intentionally gentle: this rides on `score`, so a heavy
  multiplier can re-route the whole rack into longer follows to dodge one
  near-miss. It is sized to break a genuine near-tie, not to override run-out
  value. `clearanceRisk` and `pocketRisk` share two helpers — `rampPenalty`
  (the floor-to-1 ramp) and `nearestApproach` (closest path approach to a
  point, with an optional per-segment direction filter for pocket mouths).

The route search has a strict pass and a lenient fallback. Preserve that
shape when tuning thresholds: strict keeps chosen landings consistent with
drawn windows; lenient prevents otherwise solvable layouts from failing.

### Forward Beam Search

Authoritative source: [src/solver.ts](../src/solver.ts).

These parameters affect global pattern selection:

- `BEAM`: number of nodes retained per layer.
- `EVAL_CAP`: number of route candidates fully evaluated per expansion pass.
- `TYPE_RANK`: private complexity ordering by shot type.
- `complexityDiscount`: sort-key-only tie-break for simpler routes.
- `alignBoost`: sort-key-only preference for routes entering along the next
  shot line.
- `expandNodes` and `expandPass`: strict/lenient expansion policy.
- `resolveShotZones`: resolves the chosen-pocket gated zone for each non-final
  shot and stamps it on `PlannedShot.zone`, so the renderer and the explanation
  read the same zone the route was scored against instead of rebuilding it. In
  the same pass it remeasures zoneLen/entryDeg against that zone with the
  pocket actually chosen — the role it previously had as `remeasureZones`.

Only `score` is the reported run-out probability. `sortKey` is private and
must remain a tie-break rather than a user-visible score.

### Layout Generation

Authoritative source: [src/generator.ts](../src/generator.ts).

These parameters control what problems the solver is asked to solve:

- `CUSHION_MARGIN`, `MIN_SEPARATION`, and `POCKET_MARGIN`: random object-ball
  placement constraints.
- Per-ball placement attempt limit inside `randomPositions`.
- `MIN_SCORE_PER_SHOT`: generated-layout acceptance bar, scaled by ball count.
- `MAX_TRIES`: rejection-sampling budget.
- `quickFeasible`: cheap per-turn pocket-line precheck.
- `mulberry32`: deterministic PRNG used for seed reproducibility.
- Remaining-ball numbering derived from `ballCount`.

Generation parameters affect the distribution of layouts and may hide or
expose solver weaknesses. They do not change how a fixed layout is solved,
except by deciding whether that layout is presented.

### UI And Presentation Parameters

These parameters do not usually change the solver's choice for a fixed layout,
but they affect how users reach and inspect solver decisions:

- [src/main.ts](../src/main.ts): `MIN_BALLS`, `MAX_BALLS`, `DEFAULT_BALLS`,
  URL hash parsing, step navigation, and the selected fixed skill profile.
- [src/scene.ts](../src/scene.ts): step semantics, zone display radius,
  primary-zone cap from `windowRef`, and second-choice pocket expansion. Reads
  the resolved `PlannedShot.zone` (and its own obstacles/gate for the alternate
  pockets) rather than rebuilding the gated zone, so it no longer depends on
  value.ts.
- [src/render.ts](../src/render.ts): SVG scale, rail width, colors, markers,
  and ball drawing.
- [src/explain.ts](../src/explain.ts): text thresholds and phrasing for shot
  explanations.

If a presentation parameter starts feeding back into scoring or candidate
selection, move it into the relevant solver section above.

## Common Change Checklist

Before editing solver behavior:

1. Read [CONTEXT.md](../CONTEXT.md) for domain terms.
2. Read the relevant module section in this guide.
3. Check whether an ADR already fixes the intended behavior.
4. Add or update focused tests for the changed decision rule.
5. Update this guide if the parameter inventory or module responsibility
   changes.

After editing solver behavior:

1. Run the smallest relevant test first.
2. Run `npm test` when practical.
3. Use snapshot scripts when a visual route or zone changed.
4. Keep numeric defaults in source and tests, not in this guide.
