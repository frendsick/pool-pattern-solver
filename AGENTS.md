# Agent Notes

Start with [docs/solver-guide.md](./docs/solver-guide.md) when working on
solver behavior, generation, zones, route choice, or player-skill tuning.

Keep that guide updated whenever a solver decision parameter is added,
removed, renamed, reinterpreted, or moved. It should describe durable behavior
and source ownership, not duplicate current numeric defaults.

Use [CONTEXT.md](./CONTEXT.md) for domain language and [docs/adr/](./docs/adr/)
for preserved design decisions.

See [architecture.md](./architecture.md) for how the modules fit together
(the module map, layering, and data flow).

## General Instructions

- Never mention Claude or AI usage

## Agent skills

Always load the relevant doc when the matching workflow comes up:

- Git: [docs/agents/git.md](docs/agents/git.md)
- Review: [docs/agents/review.md](docs/agents/review.md)
