# 9-Ball Pattern Solver

A pattern-play trainer: generates random 9-ball end-game layouts with ball in
hand, solves for the run-out pattern with the highest run-out
probability, and draws it step by step with pie-shaped position windows, natural
angles, coming into the line of the shot.

Built on the principles in Dr. Dave Alciatore's *Pattern Play Principles*
(Billiards Digest, Feb 2021) and Florian Kohler's *Pattern Play* (PoolDawg
Academy).

## Run

```sh
npm install
npm run dev     # local app at the printed URL
npm test        # unit tests + golden principle scenarios
npm run build   # type-check + production bundle
```

The current layout's seed is kept in the URL hash (`#s=12345`), so layouts
are shareable and reproducible.

## Install on Android (offline PWA, no hosting)

The app is an installable, fully-offline PWA: once installed, its service worker
serves everything from cache, so it needs no local or public network. The only
trick is that a browser will only *install* it from a secure context, which we
reach locally instead of by hosting it. See
[docs/adr/0007](./docs/adr/0007-installable-offline-pwa-no-hosting.md) for why.

`localhost` is a secure context, and `adb reverse` maps the phone's localhost to
your machine, so no HTTPS or certificate is needed.

```sh
npm run build
npm run preview                       # serves dist/ at http://localhost:4173
adb reverse tcp:4173 tcp:4173         # phone (USB, debugging on) → your laptop
```

On the phone, open `http://localhost:4173` in Chrome → menu → **Install app**.
After it installs you can unplug. It runs full-screen and offline from the home
screen. To ship a new version: rebuild, re-run the two commands above, reopen the
installed app. The `autoUpdate` service worker swaps its cache on next launch.

## Documentation

- [Architecture](./architecture.md): module map, layering, and data flow.
- [Solver guide](./docs/solver-guide.md): solver behavior and tuning ownership.
- [Domain language](./CONTEXT.md): canonical terminology.
- [Design decisions](./docs/adr/): preserved architectural decisions.

Visual snapshots for review: `npx vite-node scripts/snapshot.ts` writes every
step of a seeded puzzle to `/tmp/pps-snapshots/`.
