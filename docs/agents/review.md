# Review

Rules for the pre-PR review loop.

## Review loop

Before opening a pull request:

1. Check for duplicated logic, unused flexibility, avoidable dependencies, and
   abstractions without a current requirement. Prefer existing code,
   standard-library operations, and native platform features when they preserve
   the required behavior. Give the location and smallest correction for each
   finding.
2. Review the changes.
3. **MUST** fix every issue the reviewer reports without pausing, asking, or surfacing the review output to the user as a stopping point.
4. Re-run the reviewer on the fixed diff.
5. Loop steps 3-4 until the reviewer reports no must-fix or should-fix issues.
6. Only then open the PR. See [git.md](./git.md).

## Why no pausing

Stopping mid-loop wastes a round-trip and frustrates the user. The review is the work
of finishing the change. Treat it as part of the change, not a separate sign-off.
