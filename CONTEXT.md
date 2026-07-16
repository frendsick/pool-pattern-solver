# Pool Pattern Solver

A 9-ball pattern-play trainer that generates late-rack layouts and finds the best run-out pattern.

## Language

**Pattern**:
A complete run-out plan: the ball-in-hand cue-ball placement, then each remaining ball's pocket, cue-ball Route, and targeted Position Window.
_Avoid_: run, sequence, order (the ball order is forced by 9-ball rules)

**Layout**:
A randomly generated set of remaining object-ball positions with no cue ball because the player has Ball in Hand.
_Avoid_: position (reserved for cue-ball position play), rack

**Ball in Hand**:
The starting condition of every Layout, in which the opening cue-ball placement is the first decision of the Pattern. The solver or player may choose that exact placement.
_Avoid_: handball, opening Alternative Leave

**Position Window**:
The region of cue-ball positions from which the next ball can be made to its chosen pocket and the cue ball can still be moved toward the following ball's window. Every point in the Window must be feasible and nearly as effective as its best point.
_Avoid_: shape zone, position zone (use Position Window in player-facing language)

**Alternative Leave**:
An exact cue-ball position selected within a Position Window to ask for the best continuation from that point. It forks the Pattern while retaining the earlier shots as history.
_Avoid_: what-if, ghost placement

**Route**:
How the cue ball travels from one shot to the next, defined by a Shot Type, contacted rails, and travel distance. The final ball also has a Route, chosen to avoid a scratch rather than reach another Position Window.

**Shot Type**:
One of five idealized vertical cue-ball actions (stop, follow, stun, touch of low, or draw) that determines the cue ball's departure behavior after contact.
_Avoid_: spin shot, english

**Sidespin**:
Signed left or right cue-ball spin composed with a Shot Type rather than replacing it. Positive means right spin and negative means left spin.
_Avoid_: english, spin shot

**Skill Profile**:
The parameter set describing the assumed player's potting and position-play ability, used for both Position Window boundaries and Pattern scoring.
_Avoid_: difficulty setting

**Run-out Probability**:
The score of a Pattern: the product of potting and Position Window reach probabilities for each shot, with scratch avoidance replacing Window reach on the final ball. The best Pattern maximizes this probability.
_Avoid_: score, fitness, cost
