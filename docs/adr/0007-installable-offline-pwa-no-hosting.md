# Phone install is an offline PWA loaded over a local transport, not hosting or a native wrapper

The app is a static client-side build (Vite, no backend), so it makes the whole rack
offline already. To put it on a phone we ship it as an installable **PWA**
(`vite-plugin-pwa`: generated manifest + Workbox service worker that precaches every
build asset, `registerType: 'autoUpdate'`), and we **install it over a local transport
instead of hosting it on the internet**. After the one-time install the service worker
serves everything from cache, so the app needs zero network — local or public.

A browser will only register a service worker from a *secure context*. We reach one
locally: **Android** via USB + `adb reverse tcp:4173 tcp:4173`, so the phone's
`http://localhost:4173` (localhost is a secure context with no certificate) maps to a
local `vite preview`; **iOS** later via local HTTPS over Wi-Fi with a trusted `mkcert`
root CA (no `adb` equivalent, and iOS needs HTTPS for an offline service worker). The
app code is identical for both — only the first-load transport differs.

On phones the table goes full-screen in both orientations. We do this with **CSS**: a
`pointer: coarse` media query for full-screen + a translucent bottom overlay for the
controls, and an `orientation: portrait` rule that `transform: rotate`s the SVG so the
2:1 table fills the screen. Drag stays correct across the rotation by mapping pointer
coordinates through `svg.getScreenCTM().inverse()` instead of `getBoundingClientRect`
math — so `render.ts`/`svgToTablePoint` are untouched and desktop is unaffected.

## Considered Options

- **Offline PWA installed over a local transport (chosen)** — keeps the static
  no-backend shape, real home-screen install, fully offline after one tethered/LAN
  install. Cost: the install needs a transient local secure context (USB-localhost or
  trusted-cert HTTPS), and iOS's cert-trust step is fiddly.
- **Native wrapper (Capacitor/APK sideload)** — true file-only install, no server ever,
  but adds a native build/toolchain and a WebView shell for a thing that is already a
  self-contained web app.
- **Plain LAN HTTP** — simplest to serve, but not a secure context: no service worker,
  so no real install and no offline (the laptop would have to be running every time).

## Consequences

- There is no deploy/hosting step and no public URL — "ship a new version" means
  re-tether, reload, and let the `autoUpdate` service worker swap its precache.
- The mobile full-screen/rotate behavior is render-pure: it lives entirely in CSS +
  the pointer-mapping change, so the headless snapshot tool and desktop layout are
  unchanged.
- iOS is a deliberate follow-up, not parity at launch — Android (USB-localhost) is the
  first-class path because it needs no certificates.
