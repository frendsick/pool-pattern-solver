# Idealized four-shot-type cue-ball model, no physics engine

The solver predicts cue-ball travel with four idealized shot types — stop, follow (natural roll angle), stun (tangent line), draw — each fixing a departure direction off the object ball, with travel distance as the free speed parameter and mirror-law rail rebounds. We deliberately rejected a time-stepped physics simulation: the knowledgebase (Dr. Dave's pattern-play principles, the PoolDawg zone-play article) *teaches* in exactly this idealized vocabulary, so a pattern the solver finds is by construction explainable in the same terms it is drawn and annotated with. A physics engine would find routes no principle can name and make "ease of execution" scoring murky.

## Consequences

- Sidespin is **deferred, not rejected** — we want it eventually. Its main effect is altering rail-rebound angles, so the Route representation must keep rail rebound as a pluggable function rather than hard-coding the mirror law.
- Routes the model cannot express (sidespin multi-rail shots, banks, masse) are invisible to the solver; the "best" pattern is best within the idealized vocabulary only.
