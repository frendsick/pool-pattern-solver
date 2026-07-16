# Cue-ball drag continues the rack from an Alternative Leave

The trainer lets the player drag the shooting cue ball to an Alternative Leave inside the current Position Window and re-solves the rest of the rack from there (see CONTEXT.md: Alternative Leave, Position Window). Two of the choices behind it are surprising enough to record, because a future reader will otherwise "fix" them.

## The dragged leave gets ball-in-hand (spotted) carom accuracy, even mid-rack

The shot played from an Alternative Leave is scored with the spotted-ball carom ease (`handDirEase` / `fromHand`), the same reduced direction noise the solver gives the opening ball-in-hand shot, not the higher arrival noise a mid-rack leave would really carry. This looks wrong: in a real game you cannot spot the cue ball mid-rack, so a what-if leave "should" be priced as a noisily-arrived one.

We chose spotted accuracy deliberately: the drag posits a *known-exact* placement ("from exactly here, what is the best continuation?"), which is what a trainer is for. It studies the ideal play from a chosen spot instead of simulating the error of getting there. It also falls out of the existing model for free: the solver already applies `fromHand` only to the first shot of a search, and a forked solve starting at the Alternative Leave makes that shot first, so the continuation after it keeps normal arrival noise with no special threading. We rejected arrived-leave noise (it would make every dragged what-if look harder than the question being asked) and rejected applying spotted ease to the whole continuation (only the placed shot is known-exact, while the rest is rolled into).

## The drag is a Position Window tightness diagnostic, not a free what-if explorer

The feature is framed around two invariants on the Position Window (recorded in CONTEXT.md): every spot affords a makeable shot reaching the next window (feasibility), and every spot is nearly as effective as the best (uniform effectiveness). Consequently the drag is **clamped to the drawn polygon**. While dragging it shows only the live new leg and its reach probability. On release it shows only the forked Pattern and its run-out probability, never a comparison to the solver's original. Any in-window spot that yields a dead or materially weaker continuation is a **zone-calibration bug**. Tighten the relative quality bar (`ZONE_RELATIVE`, within 80% of the window's best) or its onward-control gate (ADR-0004) rather than adding a UI state.

We rejected the free-explorer alternative (drag anywhere, best-effort shot outside the window, solver's original ghosted for comparison). It is friendlier but it would let the window stay loose: a comparison gadget invites the player to read the score difference instead of reading it as a signal that the window is wrong. The diagnostic framing is the whole point. The player expects the run-out to stay nearly flat as they drag, and a swing is the bug report.

## Consequences

- A new solver entry point continues from a fixed mid-rack leave: one seed node per open pocket from the dragged cue, then the existing forward beam search and `finalize`. The backward value surfaces (ADR-0004) depend only on the Layout, so the fork reuses the cached surfaces and only the cheap forward search re-runs. This is fast enough for re-solve on drop.
- The reported score stays pot × P(reach window) as before (ADR-0002). The fork changes which leave the chain starts from, not how it is scored.
- Clamping to the *drawn polygon* while scoring on the *zoneValue field* exposes the round-25 render-vs-scoring seam directly to the player: a polygon point can score below the field's bar. Per the feasibility invariant this is reconciled toward the field over time, never papered over in the UI.
- Forking is persistent: shots up to the current ball stay as history, `Next` walks the new continuation, the player can fork again downstream, and a "Restore solver line" control returns to the original pattern.
