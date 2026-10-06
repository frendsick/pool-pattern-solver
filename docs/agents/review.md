# Review

Rules for the pre-PR review loop.

## Review loop

Before opening a pull request:

1. Review the diff for correctness, duplication, and unnecessary complexity.
2. **MUST** fix every issue the reviewer reports without pausing, asking, or surfacing the review output to the user as a stopping point.
3. Re-run the reviewer on the fixed diff.
4. Loop steps 2-3 until the reviewer reports no must-fix or should-fix issues.
5. Only then open the PR. See [git.md](./git.md).

## Why no pausing

Stopping mid-loop wastes a round-trip and frustrates the user. The review is the work
of finishing the change. Treat it as part of the change, not a separate sign-off.
