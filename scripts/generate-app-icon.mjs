import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INK = '#ffffff';
const TILE_TOP = '#4b48b0';
const TILE_BOTTOM = '#35328a';
const SHEEN = { color: '#ffffff', opacity: 0.16, width: 3, fadeEnd: 46 };

const TILE = { cx: 100, cy: 100, r: 96, exponent: 5, segments: 240 };
const GLYPH = {
    height: 84,
    stroke: 20,
    xWidth: 62,
    zeroRadius: 28,
    zeroRing: 19,
    gap: 8,
    zeroHeight: 92
};
const WEAVE_SPAN = [0.3, 0.7];
const NOTIFY_DOT = { cx: 172, cy: 28, r: 26, gap: 7, color: '#ff3b30' };
const CANVAS = {
    generic: { x: 0, y: 0, size: 200 },
    apple: { x: -10, y: -10, size: 220 }
};

const VARIANTS = {
    hairline: { weaveGap: 1.5, underInk: INK },
    'two-tone': { weaveGap: 0, underInk: '#d6d3f3' },
    'two-tone-soft': { weaveGap: 0, underInk: '#e9e7fa' },
    'two-tone-hairline': { weaveGap: 1.5, underInk: '#d6d3f3' },
    'two-tone-hairline-soft': { weaveGap: 1, underInk: '#e9e7fa' }
};
const DEFAULT_VARIANT = 'hairline';

const num = (n) => String(+n.toFixed(2));

function squirclePath({ cx, cy, r, exponent, segments }) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        const x = cx + r * Math.sign(c) * Math.abs(c) ** (2 / exponent);
        const y = cy + r * Math.sign(s) * Math.abs(s) ** (2 / exponent);
        points.push(`${num(x)},${num(y)}`);
    }
    return `M${points.join('L')}Z`;
}

function glyphGeometry({
    height,
    stroke,
    xWidth,
    zeroRadius,
    zeroRing,
    gap,
    zeroHeight
}) {
    const capR = stroke / 2;
    const xHalfW = xWidth / 2 - capR;
    const xHalfH = height / 2 - capR;
    const zeroCx = xWidth / 2 + gap + zeroRadius;
    const zeroHalf = zeroHeight / 2 - zeroRadius;

    const minX = -xWidth / 2;
    const maxX = zeroCx + zeroRadius;
    const offsetX = 100 - (minX + maxX) / 2;
    const offsetY = 100;

    return {
        under: [
            -xHalfW + offsetX,
            -xHalfH + offsetY,
            xHalfW + offsetX,
            xHalfH + offsetY
        ],
        over: [
            -xHalfW + offsetX,
            xHalfH + offsetY,
            xHalfW + offsetX,
            -xHalfH + offsetY
        ],
        zero: {
            x: zeroCx + offsetX,
            y1: -zeroHalf + offsetY,
            y2: zeroHalf + offsetY
        },
        stroke,
        zeroOuter: zeroRadius * 2,
        zeroInner: (zeroRadius - zeroRing) * 2
    };
}

const segment = ([x1, y1, x2, y2]) =>
    `M${num(x1)},${num(y1)}L${num(x2)},${num(y2)}`;

function subSegment([x1, y1, x2, y2], [t0, t1]) {
    return [
        x1 + (x2 - x1) * t0,
        y1 + (y2 - y1) * t0,
        x1 + (x2 - x1) * t1,
        y1 + (y2 - y1) * t1
    ];
}

function buildSvg({ weaveGap, underInk }, notify, canvas) {
    const box = `${canvas.x} ${canvas.y} ${canvas.size} ${canvas.size}`;
    const g = glyphGeometry(GLYPH);
    const tile = squirclePath(TILE);
    const zeroPath = `M${num(g.zero.x)},${num(g.zero.y1)}L${num(g.zero.x)},${num(g.zero.y2)}`;
    const bg = 'url(#tile)';
    const stroke = (d, color, width, cap = 'round') =>
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${num(width)}" stroke-linecap="${cap}"/>`;

    const parts = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="1024" height="1024">`,
        `<defs>`,
        `<linearGradient id="tile" gradientUnits="userSpaceOnUse" x1="0" y1="${TILE.cy - TILE.r}" x2="0" y2="${TILE.cy + TILE.r}"><stop offset="0" stop-color="${TILE_TOP}"/><stop offset="1" stop-color="${TILE_BOTTOM}"/></linearGradient>`,
        `<linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="0" y1="${TILE.cy - TILE.r}" x2="0" y2="${SHEEN.fadeEnd}"><stop offset="0" stop-color="${SHEEN.color}" stop-opacity="${SHEEN.opacity}"/><stop offset="1" stop-color="${SHEEN.color}" stop-opacity="0"/></linearGradient>`,
        `<clipPath id="inside"><path d="${tile}"/></clipPath>`,
        `<mask id="badge"><rect x="${canvas.x}" y="${canvas.y}" width="${canvas.size}" height="${canvas.size}" fill="white"/>${notify ? `<circle cx="${NOTIFY_DOT.cx}" cy="${NOTIFY_DOT.cy}" r="${NOTIFY_DOT.r + NOTIFY_DOT.gap}" fill="black"/>` : ''}</mask>`,
        `</defs>`,
        `<g mask="url(#badge)">`,
        `<path d="${tile}" fill="${bg}"/>`,
        `<path d="${tile}" fill="none" stroke="url(#sheen)" stroke-width="${SHEEN.width}" clip-path="url(#inside)"/>`,
        stroke(segment(g.under), underInk, g.stroke)
    ];
    if (weaveGap > 0)
        parts.push(
            stroke(
                segment(subSegment(g.over, WEAVE_SPAN)),
                bg,
                g.stroke + weaveGap * 2,
                'butt'
            )
        );
    parts.push(
        stroke(segment(g.over), INK, g.stroke),
        stroke(zeroPath, INK, g.zeroOuter),
        stroke(zeroPath, bg, g.zeroInner),
        `</g>`
    );
    if (notify)
        parts.push(
            `<circle cx="${NOTIFY_DOT.cx}" cy="${NOTIFY_DOT.cy}" r="${NOTIFY_DOT.r}" fill="${NOTIFY_DOT.color}"/>`
        );
    parts.push(`</svg>`, ``);
    return parts.join('\n');
}

function parseArgs(argv) {
    let variant = DEFAULT_VARIANT;
    let output = null;
    let notify = false;
    let apple = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--variant') variant = argv[++i];
        else if (argv[i] === '--notify') notify = true;
        else if (argv[i] === '--apple') apple = true;
        else output = argv[i];
    }
    if (!(variant in VARIANTS)) {
        throw new Error(
            `Unknown variant "${variant}". Available: ${Object.keys(VARIANTS).join(', ')}`
        );
    }
    return { variant, output, notify, apple };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { variant, output, notify, apple } = parseArgs(process.argv.slice(2));
const defaultName = `VRCX-0${apple ? '-apple' : ''}${notify ? '-notify' : ''}.svg`;
const target = resolve(output ?? resolve(root, 'images/brand', defaultName));
writeFileSync(
    target,
    buildSvg(VARIANTS[variant], notify, apple ? CANVAS.apple : CANVAS.generic)
);
console.log(
    `${variant}${apple ? ' (apple)' : ''}${notify ? ' (notify)' : ''} -> ${target}`
);
