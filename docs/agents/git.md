# Git conventions

Rules for commits, branches, and pull requests in this repo.

## Commits

- MUST use conventional commit format.
- MUST sign every commit. Never bypass signing with `-c commit.gpgsign=false` or
  `--no-gpg-sign`. If signing fails, stop and ask the user to `ssh-add` their SSH key.
- MUST NOT append `Co-Authored-By` lines, mentions of Claude or AI usage, or any
  other tooling references to commit messages, PR descriptions, or branch names.
- MUST NOT commit Claude-related files (`.claude/`, agent memory, transcripts).
- MUST NOT commit binary files unless the user explicitly asks for it.
- MUST keep one commit per functionality. Don't mix unrelated changes.
- MUST keep commit messages brief.

## Branches

- MUST NOT modify `main` directly. All work happens on a feature branch.
- MUST use conventional prefixes: `feat/`, `refactor/`, `fix/`, etc. This applies
  to worktree branches too — rename away from the `worktree-` default before pushing.

## Workflow

- MUST make a commit once a planned change is finished.
- MUST open a pull request once code review finds no more issues to fix. See [review.md](./review.md) for the review loop.
