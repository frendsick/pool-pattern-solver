# Phone install is an offline PWA loaded over a local transport, not hosting or a native wrapper

The app is a static client-side build (Vite, no backend), so it makes the whole rack
offline already. To put it on a phone we ship it as an installable **PWA**
(`vite-plugin-pwa`: generated manifest + Workbox service worker that precaches every
build asset, `registerType: 'autoUpdate'`), and we **install it over a local transport
instead of hosting it on the internet**. After the one-time install the service worker
serves everything from cache, so the app needs zero network — local or public.

A browser will only register a service worker from a *secure context*. On Android we
reach one via USB + `adb reverse tcp:4173 tcp:4173`, so the phone's
`http://localhost:4173` (localhost is a secure context with no certificate) maps to a
local `vite preview`.

On phones the layout becomes a single column with **CSS** (gated on `pointer: coarse`,
so desktop is untouched): the table keeps its desktop landscape orientation and is
contained to fill the leftover height, the controls sit in a normal block below it, and
the explanation caption sits above it — shown only when the viewport is tall enough
(`min-height`) to fit it without crowding the table. Drag stays correct under the
contained/centered scaling by mapping pointer coordinates through
`svg.getScreenCTM().inverse()` instead of `getBoundingClientRect` math, so
`render.ts`/`svgToTablePoint` are untouched.

## Considered Options

- **Offline PWA installed over a local transport (chosen)** — keeps the static
  no-backend shape, real home-screen install, fully offline after one tethered
  install. Cost: the install needs a transient local secure context over USB-localhost.
- **Native wrapper (Capacitor/APK sideload)** — true file-only install, no server ever,
  but adds a native build/toolchain and a WebView shell for a thing that is already a
  self-contained web app.
- **Plain LAN HTTP** — simplest to serve, but not a secure context: no service worker,
  so no real install and no offline (the laptop would have to be running every time).

## Consequences

- There is no deploy/hosting step and no public URL — "ship a new version" means
  re-tether, reload, and let the `autoUpdate` service worker swap its precache.
- The mobile layout is render-pure: it lives entirely in CSS + the pointer-mapping
  change, so the headless snapshot tool and desktop layout are unchanged.
