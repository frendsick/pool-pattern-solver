# Sidespin as an orthogonal control axis

Status: Accepted.

ADR-0001 deliberately deferred sidespin while preserving the no-physics-engine
cue-ball model. That core decision still stands: solver routes must remain
idealized, explainable, and priced through the Skill Profile rather than by a
time-stepped physics simulation.

Sidespin is now part of the model, but not as another Shot Type. Shot Type stays
the vertical cue-ball action: stop, follow, stun, touch of low, or draw.
Sidespin is a signed left/right control axis composed with those actions.

## Decision

Represent sidespin as a normalized signed amount:

- `0` means no sidespin.
- positive means right spin.
- negative means left spin.
- `1.0` means maximum practical side offset near the miscue limit.

The first modeled amounts are `-0.5`, `0`, and `0.5`, where `0.5` is half of
maximum practical sidespin. Maximum sidespin is deliberately omitted from the
first search vocabulary because ordinary pattern play should not need it for
good run-outs.

The first implementation models sidespin only through cushion rebound. Known
full effects of sidespin include squirt, swerve, object-ball throw, and changed
cushion rebound angles, but squirt, swerve, and throw are deferred. The first
solver win is rail-assisted position: sidespin can open or hold a rebound angle
that mirror-law rebound cannot express.

Cushion rebound is calibrated by diamond displacement: half-maximum sidespin
(`0.5`, roughly one tip of spin) moves a straight long-rail-to-long-rail kick
about one diamond from the mirror line, while maximum sidespin would move about
two diamonds. The effect scales down as the cue ball attacks the cushion at a
larger angle.

That dropoff is an intentional heuristic: the rebound adjustment is multiplied
by the cue ball's normal component into the cushion, so square cushion contact
gets the full calibrated effect and glancing contact gets little effect. In
real play, the rebound change depends on the spin/speed ratio at cushion
contact, not just the originally chosen sidespin amount. That ratio can be
changed before the cushion by cloth drag, draw/drag action, object-ball
collision speed loss, shot speed, cue elevation, and table conditions. The
implementation does not maintain that physical spin state.

The implementation also does not model spin transfer or decay across rails. A
second-rail path reuses the same chosen sidespin amount with the same
angle-dropoff rule, instead of deriving the remaining or cushion-induced spin
from the previous cushion impact.

Nonzero sidespin carries its own execution cost and extra rebound-direction
uncertainty. This keeps sidespin available as a useful route-control tool
without making the solver overuse it as the default answer to position.
Route search treats nonzero sidespin as a fallback axis: if the no-spin route
for a Shot Type and target already has a usable path sample, the spin variants
are not enumerated for that type/target.

Final-ball safety routes do not use sidespin in the first implementation. They
have no next Position Window to reach, and adding spin there would mostly create
odd explanations before the safety value is well calibrated.

## Consequences

- Route generation composes sidespin with existing Shot Type choices instead
  of adding `leftFollow`, `rightDraw`, or similar shot types.
- Code should name the field `sidespin`, not `side`, so the implementation
  matches the domain term directly.
- Player-facing explanations use "left spin" and "right spin".
- Direct no-rail routes use `0` sidespin in the first implementation because
  rebound-only sidespin has no modeled benefit before a cushion.
- The rebound model is best read as a pattern-play control vocabulary, not as a
  measured ball-cushion simulator. It can compare natural and left/right-spin
  route shapes, but it should not be used to predict exact multi-rail spin
  physics.
- ADR-0001 remains accepted for the idealized cue-ball model and the rejection
  of a physics engine; this ADR amends only its deferred-sidespin limitation.
