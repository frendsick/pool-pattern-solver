# Pool Pattern Solver

A 9-ball pattern-play trainer: generates random late-rack layouts, solves for the best run-out pattern, and draws it in the style of the PoolDawg pattern-play diagrams (pie-shaped position zones, arrowed cue-ball paths).

## Language

**Pattern**:
A complete run-out plan: the ball-in-hand cue-ball placement, then for each remaining ball the chosen pocket, the cue-ball route to the next shot, and the targeted position zone.
_Avoid_: run, sequence, order (order is forced by 9-ball rules and is not a decision)

**Layout**:
A randomly generated set of remaining object-ball positions (no cue ball — the player has ball in hand) that the solver takes as input.
_Avoid_: position (reserved for cue-ball position play), rack

**Ball in Hand**:
The starting condition of every Layout: the solver chooses the opening cue-ball placement as the first decision of the Pattern.

**Position Zone**:
The pie-shaped region of cue-ball positions from which the next ball can be made to its chosen pocket AND the cue ball can still be moved on toward the following ball's zone (onward control); bounded by obstacle balls, pocketability/cut limits (max cut 60°, beyond a quarter-ball hit ~48° only within ~1 m), a ~13 cm no-go band along the rails that is excluded unless the zone exists nowhere else, and a ~25 cm clearance from the object ball itself (a cue ball finishing on top of the next ball is cramped, hard inside ~10 cm) (PoolDawg's "pie-shaped diagram"). The drawn zone is where you'd be HAPPY, not everywhere the shot merely exists: only positions within 80% of the best the zone offers count. Onward control discounts an exit by the travel the pot FORCES on the cue ball (pocket pace at the cut angle, exp(-t/~115 cm)) and by the exit type's execution reliability (draw is always the toughest); travel chosen beyond the forced minimum costs nothing, so the window stays long along the line of the shot, away from the object ball, and natural multi-rail routes count fully. Zones via pockets other than the chosen one are drawn fainter as second-choice expansions, held to the primary pocket's quality bar.
_Avoid_: shape zone, window (see Flagged ambiguities)

**Route**:
How the cue ball travels from one shot to the next: a Shot Type plus rails contacted, with travel distance (speed) as the free parameter — bounded below by pocket pace (the object ball must still reach the pocket with margin, so the cue ball cannot travel less than its physics share of that speed).

**Shot Type**:
One of five idealized cue-ball actions — stop, follow (natural roll angle), stun (tangent line), touch of low (slight draw, just off the tangent), draw — that fixes the cue ball's departure direction off the object ball; sidespin is deferred to a later version (see ADR-0001). Each type has an execution reliability (stop 0.99 … draw 0.85) that multiplies a route's P(position): draw is always the toughest of the available shots, and gets worse beyond ~1 m of cue-to-ball distance (it needs a much harder stroke). Routes that skim a pocket mouth carry a scratch-risk penalty; travel distance is kept to what is needed.
_Avoid_: english, spin shot

**Skill Profile**:
The parameter set describing the assumed player — P(pot) as a function of cut angle and distance, maximum makeable cut, position-speed error — used for both zone boundaries and scoring; v1 ships one fixed intermediate profile.
_Avoid_: difficulty setting

**Run-out Probability**:
The score of a Pattern — the product over its shots of P(pot) × P(reach the next Position Zone); the solver's "best pattern" is the one maximizing it.
_Avoid_: score, fitness, cost

**Golden Scenario**:
A hand-built fixture Layout with a known-correct Pattern (reconstructed from the knowledgebase articles) that the solver must reproduce in tests; the gate for unlocking configurable ball count.

## Relationships

- A **Pattern** contains one shot per remaining ball of a **Layout**, in forced lowest-ball-first order
- Each shot in a **Pattern** targets exactly one pocket and one **Position Zone** (the last shot has no zone)
- A **Route** connects a shot to the next shot's **Position Zone**
- A **Layout** is only presented to the user if the solver finds at least one complete **Pattern** for it (solver-validated generation; rejected layouts are re-rolled)

## Example dialogue

> **Dev:** "Does the solver pick which ball to shoot first?"
> **Domain expert:** "No — 9-ball forces lowest-ball-first. A **Pattern** only decides pockets, **Routes**, and which **Position Zone** (and which side of it) to land in."

## Flagged ambiguities

- "position window" vs "position zone" — resolved: canonical term is **Position Zone**, matching the PoolDawg pie-shaped-zone concept.
