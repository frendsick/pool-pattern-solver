# Run-out probability as the pattern score

A pattern is scored as the product of per-shot probabilities — P(pot | cut angle, distance) × P(reach the next position zone | zone size, approach angle vs. zone axis, route length, shot type, and whether a shorter no-rail route already reaches that window) — under a fixed intermediate Skill Profile. We rejected a hand-tuned weighted-penalty score: every pattern-play principle (bigger zones, coming into the line, natural angles, simplicity) maps naturally onto a probability factor, the factors compose without arbitrary weights, and the resulting number is meaningful to the user ("~78% chance to run out") and per-shot explainable in the UI.

## Consequences

- Tuning means calibrating probability curves in the Skill Profile, not rebalancing weights — disagreements with the solver's choice are resolved by asking "is that probability estimate realistic?"
- A skill slider later is purely a Skill Profile swap; the scoring code does not change.
- One deliberate impurity: near-tied patterns (within 2% relative score) are ranked with a tiny complexity discount (shot type, rails, travel — "keep it simple", Dr. Dave #1), because easy layouts saturate every option near 100% and pure probability cannot break the tie. Outside that band, the higher probability wins. The discount affects ranking only; the reported Run-out Probability stays pure.
