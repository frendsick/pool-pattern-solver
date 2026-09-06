# Architecture

A 9-ball pattern-play trainer. It **generates** a random late-rack layout, **solves**
for the highest run-out-probability pattern, and **renders** it as a top-down table
diagram with pie-shaped position windows and arrowed cue-ball routes. The whole thing
is a static client-side app (Vite + TypeScript, no backend). The solver runs in the
browser. It ships as an installable, fully-offline **PWA** (`vite-plugin-pwa` precaches
every build asset). It is installed onto Android over USB + `adb reverse` to `localhost`
rather than hosted, and on phones the layout
stacks into a column (caption / table / controls) with the table kept in its landscape
orientation, via CSS + a `getScreenCTM` pointer mapping.
See `docs/adr/0007-installable-offline-pwa-no-hosting.md`.

For domain vocabulary (Pattern, Layout, Position Window, Route, Shot Type, Run-out
Probability, etc.) see `CONTEXT.md`. For the load-bearing design decisions see `docs/adr/`.
This file is about *how the modules fit together*.

---

## Module map

Modules grouped by layer, lowest (no project dependencies) first. Everything is under
`src/`.

| Module | Lines | Responsibility | Imports (project) |
| --- | --- | --- | --- |
| `geometry.ts` | 71 | 2D vector math, ray/segment-circle intersection, reflection. Pure, leaf. | None |
| `table.ts` | 106 | Table dimensions, pockets, `Ball`/`Layout` types, `effectiveAcceptance`, `onTable`. | `geometry` |
| `shots.ts` | 388 | Idealized cue-ball model (ADR-0001/0003): the 5 shot types, 30°-rule carom path, rail rebound, `tracePath`, `caromLocus`, `caromCurve`, obstacle/scratch clearance. | `geometry`, `table` |
| `skill.ts` | 487 | Skill Profile (ADR-0002): P(pot) vs cut/distance, max cut, landing-spread sigmas, and type reliability. `INTERMEDIATE` is the shipped profile. | `geometry`, `table`, `shots` |
| `zone.ts` | 631 | Position Window: the `zoneValue` scoring field + `zonePolygons` render approximation. `zoneContext`, `zonePeak`, `zoneBar`, rail-band/proximity logic. | `geometry`, `table`, `shots`, `skill` |
| `value.ts` | 166 | Backward value surfaces (ADR-0004): `V_k` rasters built from the 9 down, the shared onward-control gate (`gateFor`, `surfacesForLayout`, `zoneInputsForBall`). | `geometry`, `table`, `skill`, `zone` |
| `route.ts` | 701 | Route exploration & scoring: `zoneTargets`, `routeCandidates` (fast prune), `expectedNextPot` (landing-spread quadrature), `pocketRisk`, `clearanceRisk`, `finalSafetyRoute` (the final ball's no-scratch pot). | `geometry`, `table`, `shots`, `skill`, `zone`, `value` |
| `seed.ts` | 187 | Ball-in-hand seeds: angle×distance grid per pocket + shotline-aligned `alignedCuts`. Produces the beam search's `initialNodes`. | `geometry`, `table`, `shots`, `skill`, `zone`, `value`, `route`, `solver`(types) |
| `solver.ts` | 464 | Beam search over Patterns. `solve`, `solveFromCue`, `previewLegFromCue`, `expandNodes`, `finalize`. The orchestrator. | `geometry`, `table`, `shots`, `skill`, `zone`, `value`, `route`, `seed`, `explain` |
| `explain.ts` | 65 | Turns a `PlannedShot` into one human-readable sentence. | `geometry`, `shots`, `skill`, `solver`(types) |
| `generator.ts` | 110 | Solver-validated layout generation: rejection-sample positions, `solve`, accept on score. `mulberry32` seeded RNG. | `geometry`, `table`, `skill`, `solver`, `shots` |
| `generator.worker.ts` | 9 | Runs the existing generator in a Web Worker. | `generator`, `generation` |
| `generation.ts` | 50 | Worker message types and pattern transfer. Sends backward grids and restores zone lookup functions and the surface cache. | `generator`(types), `skill`(types), `value` |
| `interaction.ts` | 102 | Hit-testing & clamping for drag: point-in-polygon, legal cue position, `wholeTablePolygon`. | `geometry`, `table` |
| `scene.ts` | 162 | Builds a `Scene` (one Pattern step) for the renderer: gathers window polygons, paths, ghosts. Shared by app and snapshot tool. | `geometry`, `table`, `skill`, `solver`, `zone`, `render`, `interaction` |
| `render.ts` | 199 | Pure SVG renderer + `svgToTablePoint` inverse mapping. No DOM events. | `geometry`, `table` |
| `playback.ts` | 165 | Kinematic shot replay (ADR-0006): maps animation time `t` to ball positions along the solver's already-traced geometry under one rolling-friction constant. Pure, no DOM/time. | `geometry`, `shots`, `solver`(types) |
| `main.ts` | 407 | App entry: DOM wiring, puzzle lifecycle, step navigation, drag handlers (opening cue + alternative leave), the per-shot `requestAnimationFrame` playback loop, calls scene/render. | `skill`, `generation`, `generator`(types), `geometry`, `table`, `solver`, `scene`, `render`, `playback`, `interaction` |

### Dependency layering

```
            geometry            (leaf: pure math)
               │
             table              (board, balls, pockets)
               │
             shots              (cue-ball physics, ADR-0001/0003)
               │
             skill              (all probabilities, ADR-0002)
               │
             zone               (Position Window field + polygon)
               │
             value              (backward V_k surfaces, ADR-0004)
               │
             route              (route candidates + scoring)
            ╱   │
        seed    │
            ╲   │
            solver              (beam-search orchestrator) ── explain
            │
        generator
        (build layout)
            │
        ┌───┴──────┬──────────┬───────────┐
     scene ──    playback   interaction   main  (browser app: events, lifecycle)
       render
```

`playback.ts` is a sibling consumption module: like `scene`/`render` it reads a
solved Pattern, but it produces ball *positions over time* rather than a static
Scene. `main.ts` feeds those positions back through `render.ts` each frame.

Arrows point from a module to the ones it depends on (read top→down = "is built on").
`solver.ts` is the hub: the lower half (geometry through route) is the scoring engine,
the upper half (generator/scene/render/main) is consumption.

---

## How a run-out (Pattern) is calculated

The solver answers: *given a Layout and a Skill Profile, what cue-ball placement and
sequence of pockets/routes maximizes the product of P(pot) × P(reach next window)?*
Order is forced (lowest ball first), so the only decisions are placement, pocket per
ball, shot type, route, and which window to land in.

It is a **two-direction** computation: a backward value pass establishes "how good is
each spot for the rest of the rack", then a forward beam search builds the Pattern,
scoring each leg against those backward surfaces.

```
 solve(layout, skill)                                            [solver.ts]
 │
 │ ── 1. BACKWARD PASS ───────────────────────────────────────  [value.ts]
 │    surfacesForLayout: build V_9, V_8, ... V_1 by induction.
 │    V_k(p) = how good cue-ball position p is for SHOOTING ball k,
 │            = P(pot k from p) · onward-control gate against V_{k+1}
 │    V_9 is pot-only. Each surface normalized to its own peak.
 │    (Every window the forward search sees is already gated by the
 │     whole tail of the rack, ADR-0004.)
 │
 │            V_9  ◄──gates── V_8  ◄──gates── V_7 ◄─ ... ─◄ V_1
 │           (pot only)
 │
 │ ── 2. SEED (ball in hand) ─────────────────────────────────  [seed.ts]
 │    initialNodes: for each open pocket on ball 1, lay an angle×distance
 │    grid of cue placements, PLUS alignedCuts, solved cut angles whose
 │    carom path runs along ball 2's shot line. Each placement that can
 │    pot ball 1 becomes a search Node {score, sortKey, done:[], pending}.
 │
 │ ── 3. FORWARD BEAM SEARCH (one ball at a time) ────────────  [solver.ts]
 │    for k = 2 .. N:  nodes = expandNodes(nodes, k)
 │       │
 │       ▼  expandNodes / expandPass:
 │       │
 │       │  zoneTargets(k)         pockets+windows reachable for ball k   [route.ts]
 │       │       │
 │       │       ▼
 │       │  routeCandidates(...)   per node: enumerate pocket × shot type [route.ts]
 │       │       │                 × travel, FAST prune by zone merit.    [shots.ts]
 │       │       │                 Held to best pocket's 80% bar (strict),
 │       │       │                 per-pocket fallback only if nothing clears.
 │       │       ▼
 │       │  top EVAL_CAP candidates:
 │       │     expectedNextPot()   full landing-spread quadrature:        [route.ts]
 │       │         integrate over the cue's landing distribution
 │       │         (speed sigma + carom-direction sigma), gated by the
 │       │         next window's zoneValue.  × type ease × windowFactor
 │       │     pocketRisk × clearanceRisk   penalize paths skimming a     [route.ts]
 │       │                                  pocket mouth / threading balls
 │       │       │
 │       │       ▼
 │       │  child.score   = parent.score × eNext × risk
 │       │  child.sortKey = score × complexityDiscount × alignBoost
 │       │                  (sortKey ranks, score is the REPORTED prob)
 │       │       │
 │       │       ▼
 │       │  keep top BEAM (40) children → next generation
 │       ▼
 │    (each Node carries done[] = shots so far, pending = the shot at ball k)
 │
 │ ── 4. FINALIZE ────────────────────────────────────────────  [solver.ts]
 │    Choose the first node with a complete final route. Append its last shot.
 │    finalSafetyRoute: the final ball has no next window, so its Route   [route.ts]
 │       is the open pocket x shot type maximizing P(pot) x P(no scratch)
 │       at minimal natural travel, scratch priced by pocketRisk, folded
 │       into Pattern.score (an all-scratch 9 collapses the leg).
 │    resolveShotZones: re-derive each shot's Position Window from the
 │       shared backward surfaces so renderer + explanation use the SAME
 │       zone the route was scored against, remeasure zoneLen/entryDeg.
 │    explainShot: one sentence per shot.                        [explain.ts]
 │
 ▼
 Pattern { shots: PlannedShot[], score }   ← score = Run-out Probability
```

### Scoring of one leg (the heart of it)

For a candidate that pots ball `k` and routes the cue toward ball `k+1`'s window:

```
P(this leg) = P(pot k)                         ◄ skill.ts: cut angle + distance + contact noise
            × P(reach k+1's window)             ◄ route.ts expectedNextPot:
                = ∫ over landing distribution        landing spread = speed σ ⊕ carom-direction σ
                    zoneValue(landing, next) dL       gated by next window (zone.ts)
              × type ease                        ◄ skill.ts: stop 0.99 ... draw 0.85, draw rail-room
              × windowFactor                     ◄ relative quality bar (80% of best effective)
            × pocketRisk × clearanceRisk          ◄ route.ts: scratch / thread-the-needle penalties

Pattern score = Π over all legs  (this is Run-out Probability, the maximand)
```

`sortKey` (used only for ranking inside the beam) multiplies in a `complexityDiscount`
(prefer simpler routes on near-ties) and `alignBoost` (prefer entries along the next
shot line). These never appear in the reported score. That stays an honest probability.

---

## Generation loop

```
generatePuzzle(seed, ballCount, skill)                          [generator.ts]
   rng = mulberry32(seed)
   repeat up to MAX_TRIES:
       positions = randomPositions(...)        reject overlaps/cushion/pocket
       quickFeasible(balls)?                    cheap reachability prefilter
       for larger layouts, collect a batch and rank with screenLayout
       for each layout in estimated-quality order:
           pattern = solve(layout, skill, bestScore)  ← full solver above
           if pattern.score ≥ minScore: return       (minScore = perShot ^ ballCount)
           else keep best-so-far
   return best                                  never fail: degrade to best sub-threshold
```

A Layout is only ever shown to the player if the solver found a complete Pattern for
it. The 9 is biased toward the foot spot (it racks center and rarely gets cleanly hit).
Screening uses a smaller beam, coarser grids, and coarse route proposals. Its score
only orders candidates. Full validation uses the normal search and separate cached
grids. A beam whose probability ceiling is below the best completed pattern can stop.

---

## Runtime / UI flow

```
main.ts (DOM ready)
   newPuzzle(seed) ─► generator.worker.ts ─► generatePuzzle
        │                  │
        │          {pattern, layout, backward grids}
        │                  │
        ◄── generation.ts restores zone gates and caches the grids
        │
   renderCurrent() ─► sceneForStep(pattern, step)  [scene.ts]
        │                 gathers window polygons (zonePolygons),
        │                 paths, ghost balls for this step
        └─► renderScene(scene) ─► SVG string        [render.ts]

   Navigation: Reveal opens the first shot. Ball buttons and prev / next select
     shots without playback. All shows the overview, Hide conceals the Pattern.
     CSS rotates the table on small portrait screens. SVG screen transforms
     map pointer input back to table inches in either orientation.

   Playback (opt-in, shot steps only):              [playback.ts + main.ts]
     • Play ─► buildPlayback(shot) ─► ShotPlayback {duration, at(t)}
     • requestAnimationFrame loop: per frame ask at(t) for ball positions,
       build a BARE Scene (overlays suppressed) at those positions, renderScene.
     • Kinematic replay over the traced geometry (ADR-0006): cue approach
       cuePos→ghost, then concurrent object-ball-to-pocket + cue carom along
       `path` to `landing`, under one friction-decel constant. Plays once, then
       auto-advances one step to the next shot's static diagram (overlays
       restored). The final shot stays frozen on its leave, with Again returning
       to the concealed layout. Stop and manual navigation cancel replay.
       main.ts assembles the bare Scene, so render.ts/scene.ts stay independent
       of animation and the snapshot tool is unaffected.

   Interaction (drag):                              [interaction.ts + main.ts]
     • Opening cue drag  ─► legalCuePosition() + solveFromCue(..., 0, cue)
            re-solves the whole Pattern from a player-placed ball in hand.
     • Alternative-leave drag (mid-rack) ─► clamp to drawn window,
            live previewLegFromCue() while dragging, on release
            solveFromCue() re-solves the remainder (forks the Pattern).
     svgToTablePoint() maps pointer px → table inches (render.ts inverse).
```

`scene.ts` and `render.ts` are pure (no DOM events) so the snapshot tool
(`scripts/snapshot.ts`) reuses them headlessly. `main.ts` owns all event wiring.

---

## Key invariants & where they live

- **One Position Window, two representations.** `zoneValue` (scoring field, `zone.ts`)
  and `zonePolygons` (drawn polygon) must agree. Disagreement is a bug, not a second
  concept. The forward search and the renderer gate against the *same* backward
  surfaces (`value.ts`).
- **Backward from the 9** (ADR-0004): onward control is `V_{k+1}` gating `V_k`, never
  one ball of lookahead. The gate is a feasibility prior (it saturates), not a ranker.
- **Score is an honest probability.** Ranking-only nudges (`complexityDiscount`,
  `alignBoost`, proximity tie-breaks) live in `sortKey`, never in `Pattern.score`.
- **Strict-then-lenient passes** keep every pocket to the best pocket's 80% bar, and
  only fall back to per-pocket bars when nothing clears it. This lets layouts solve
  without letting the hardest shot prune an easy natural one.
- **Skill is one swap point** (ADR-0002): every probability flows from a `SkillProfile`,
  so a difficulty slider is a pure profile change.
```
