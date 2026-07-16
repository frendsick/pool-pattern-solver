# Shot playback is kinematic replay over the solver's traced geometry, not a physics sim

Optional per-shot playback animates the cue and object balls in real time along the
geometry the solver already traced (`cuePos→ghost` approach, then the concurrent
object-ball-to-pocket line and the cue carom `path` to `landing`). A new `playback.ts`
maps animation time `t` to ball positions with a single rolling-friction deceleration
constant — start speeds derived from the existing `hitDistance`/`travel`/`POCKET_PACE`
— so durations emerge from distance and hit power. We deliberately did NOT build a
true velocity/momentum/spin simulation that re-derives where the balls go.

The reason is the same one behind ADR-0001's "no physics engine": the diagram and the
animation must show the *same* path. A second simulator would be a second source of
truth for ball trajectories and would drift from the route the solver scored and drew.
Reusing the traced geometry guarantees the video is just the diagram set in motion.

## Considered Options

- **Kinematic replay over traced geometry (chosen)** — real-time look, one source of
  truth, no sim-vs-diagram drift. Friction is a render-side timing fake, not grounded
  in solver-known velocities, but it never moves a ball off the traced path.
- **True physics sim** — higher fidelity, but duplicates the physics ADR-0001 idealized
  away and risks the animation diverging from the scored/drawn route.

## Consequences

- The renderer stays pure: `render.ts`/`scene.ts` are unchanged and the `main.ts` rAF
  loop rebuilds a `Scene` per frame (overlays suppressed during play), so the headless
  snapshot tool is unaffected.
- "Real-time" is a look, not a measured quantity — friction is a single tuned constant,
  not per-shot physics. Playback intentionally plays once at that fixed rate; add
  slow-motion or scrubbing only when studying the carom needs it.
- Anything the traced path omits (true collision-induced cling, throw during the roll)
  is invisible to playback, by design.
