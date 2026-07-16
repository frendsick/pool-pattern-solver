# Idealized four-shot-type cue-ball model, no physics engine

Status: Accepted, amended by [ADR-0007](./0007-sidespin-as-orthogonal-control-axis.md) for sidespin.

The solver predicts cue-ball travel with four idealized shot types: stop, follow (natural roll angle), stun (tangent line), and draw. Each fixes a departure direction off the object ball, with travel distance as the free speed parameter and mirror-law rail rebounds. We deliberately rejected a time-stepped physics simulation: the knowledgebase (Dr. Dave's pattern-play principles, the PoolDawg zone-play article) *teaches* in exactly this idealized vocabulary, so a pattern the solver finds is by construction explainable in the same terms it is drawn and annotated with. A physics engine would find routes no principle can name and make "ease of execution" scoring murky.

## Consequences

- Sidespin is modeled by ADR-0007 as an orthogonal control axis. Its first implementation changes cushion rebound only. Squirt, swerve, and object-ball throw remain outside the model.
- Routes the model cannot express (banks, masse, and deferred sidespin effects) are invisible to the solver. The "best" pattern is best within the idealized vocabulary only.
