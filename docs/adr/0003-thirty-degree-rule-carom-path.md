# Carom paths follow the 30-degree-rule shape, analytically — still no engine

The cue ball's post-contact path is no longer a straight ray along the type's
departure direction: it departs ALONG THE TANGENT LINE and sliding friction
bends it on a parabola into the carom line (the 30-degree rule, pooltool's
`30_degree_rule` example). The carom lines themselves did not change — the
existing `departureDir` follow direction is algebraically identical to the
rolling-ball theory (its deflection peaks at ~34° near a 28° cut, the
30°-rule plateau) — only the path SHAPE near the object ball is new.

The slide phase is closed-form (constant-direction friction, so a parabola),
derived from each type's impact spin as a fraction of natural roll: follow 1,
stun 0, and for draw/touch-of-low the fraction is RECOVERED from the
calibrated `signedRollShare` (draw −5/9, i.e. the backspin that realistically
survives to contact) so every calibrated carom line, zone and test holds.
One physics constant, `SLIDE_ROLL_RATIO` (µ_roll/µ_slide = 0.05, pooltool's
cloth defaults), sets the slide's share of the travel. Every term scales with
v², so the path shape is speed-invariant and scales linearly with the chosen
travel — harder shots ride the tangent line farther in absolute inches, as on
a real table.

Because of that linear scaling, the landings of ALL travels on a route lie on
one straight ray off the ghost (`caromLocus`): the interval walks
(`samplePath`, `onwardControl`) stay single-trace by walking that locus, while
the chosen candidate's exact curved path (`caromCurve` fed to `tracePath`) is
used for the drawn route, scratch/obstacle detection, and the landing-spread
quadrature. On a cushion rebound mid-slide the remaining parabola is mirrored
with the table — exact under the mirror-law abstraction.

## Consequences

- Scratch and obstacle checks near the object ball are honest: a follow or
  draw route is tested where the ball actually rolls (tangent first), not on
  the idealized carom ray.
- Draw's tangent-line hook and follow's forward bend now render, matching how
  a player visualizes the shot.
- The locus walk prices candidate landings exactly pre-rail; curved routes
  that reach a cushion are exact-sampled in route search because the true
  rail contact can differ enough to expose or hide a one-rail position route.
- `hitDistance` now lets follow use its top-spin roll share, but still prices
  draw/low with the legacy sin²+k²cos² speed share; physics says draw keeps
  less tangent speed (5/9). Recalibrating draw is a separate decision —
  flagged, not taken.
