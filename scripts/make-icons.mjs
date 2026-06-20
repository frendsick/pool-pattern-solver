// Generates the PWA icons: a 9-ball roundel on the app's dark ink background.
// Run: npm i --no-save @resvg/resvg-js && node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const BG = '#20242a';
const STRIPE = '#f2b705'; // ball-9 yellow (matches render.ts)

// ballFrac = ball diameter as a fraction of the canvas. Small for maskable so the
// content sits inside Android's ~80% safe zone; large for the plain icons.
function svg(size, ballFrac) {
  const c = size / 2;
  const r = (size * ballFrac) / 2;
  const bandH = r * 1.18; // yellow equatorial band height
  const numR = r * 0.46; // white number disk
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <clipPath id="ball"><circle cx="${c}" cy="${c}" r="${r}"/></clipPath>
    <radialGradient id="shade" cx="38%" cy="32%" r="75%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#f2efe6"/>
      <stop offset="100%" stop-color="#cfc9bb"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g clip-path="url(#ball)">
    <rect x="0" y="0" width="${size}" height="${size}" fill="url(#shade)"/>
    <rect x="0" y="${c - bandH / 2}" width="${size}" height="${bandH}" fill="${STRIPE}"/>
  </g>
  <circle cx="${c}" cy="${c}" r="${numR}" fill="#fbfaf6"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="${size * 0.012}"/>
  <text x="${c}" y="${c}" fill="#20242a" font-family="Arial, Helvetica, sans-serif" font-weight="700"
        font-size="${numR * 1.25}" text-anchor="middle" dominant-baseline="central">9</text>
</svg>`;
}

function png(svgStr, size) {
  return new Resvg(svgStr, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

mkdirSync('public/icons', { recursive: true });
const out = [
  ['icon-192.png', 192, 0.82],
  ['icon-512.png', 512, 0.82],
  ['icon-maskable-512.png', 512, 0.56],
];
for (const [name, size, frac] of out) {
  writeFileSync(`public/icons/${name}`, png(svg(size, frac), size));
  console.log('wrote public/icons/' + name);
}
