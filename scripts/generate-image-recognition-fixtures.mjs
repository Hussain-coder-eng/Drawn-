import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const FIXTURE_DIR = path.resolve('tests/fixtures/image-recognition');
const WIDTH = 192;
const HEIGHT = 192;
const CHANNELS_PER_PIXEL = 4;
const PNG_COLOR_TYPE_RGBA = 6;
const PNG_BIT_DEPTH = 8;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const fixtures = [
  {
    id: 'circle-loop',
    title: 'Circle Loop',
    image: {
      path: 'circle-loop.svg',
      width: WIDTH,
      height: HEIGHT,
      mimeType: 'image/svg+xml',
      transparent: false,
    },
    expected: {
      shapeKind: 'loop',
      closed: true,
      strokeCount: 1,
      normalizedOutline: [
        [0.5, 0.14],
        [0.72, 0.2],
        [0.86, 0.5],
        [0.72, 0.8],
        [0.5, 0.86],
        [0.28, 0.8],
        [0.14, 0.5],
        [0.28, 0.2],
        [0.5, 0.14],
      ],
      characteristics: ['single closed stroke', 'near-circular outline', 'centered loop'],
    },
    catches:
      'Checks that recognition preserves a plain closed loop without adding corners, gaps, or extra strokes.',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="192" height="192" fill="#ffffff"/>
  <circle cx="96" cy="96" r="68" fill="none" stroke="#111111" stroke-width="16" stroke-linecap="round"/>
</svg>
`,
  },
  {
    id: 'star',
    title: 'Five Point Star',
    image: {
      path: 'star.svg',
      width: WIDTH,
      height: HEIGHT,
      mimeType: 'image/svg+xml',
      transparent: false,
    },
    expected: {
      shapeKind: 'star',
      closed: true,
      strokeCount: 1,
      normalizedOutline: [
        [0.5, 0.09],
        [0.61, 0.36],
        [0.9, 0.36],
        [0.67, 0.54],
        [0.76, 0.84],
        [0.5, 0.66],
        [0.24, 0.84],
        [0.33, 0.54],
        [0.1, 0.36],
        [0.39, 0.36],
        [0.5, 0.09],
      ],
      characteristics: ['closed angular outline', 'five outer points', 'alternating concave vertices'],
    },
    catches:
      'Checks that recognizers keep sharp corners and concave turns instead of smoothing an angular icon into a blob.',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="192" height="192" fill="#ffffff"/>
  <polygon points="96,18 117,70 173,70 129,104 146,162 96,127 46,162 63,104 19,70 75,70" fill="none" stroke="#111111" stroke-width="12" stroke-linejoin="round"/>
</svg>
`,
  },
  {
    id: 'open-path',
    title: 'Open Path',
    image: {
      path: 'open-path.svg',
      width: WIDTH,
      height: HEIGHT,
      mimeType: 'image/svg+xml',
      transparent: false,
    },
    expected: {
      shapeKind: 'open-path',
      closed: false,
      strokeCount: 1,
      normalizedOutline: [
        [0.1, 0.78],
        [0.25, 0.58],
        [0.39, 0.68],
        [0.54, 0.42],
        [0.69, 0.49],
        [0.88, 0.2],
      ],
      characteristics: ['single open stroke', 'distinct endpoints', 'zig-zag direction changes'],
    },
    catches:
      'Checks that open drawings remain open and are not incorrectly closed into a loop by outline extraction.',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="192" height="192" fill="#ffffff"/>
  <polyline points="19,150 48,111 75,131 104,81 132,94 169,38" fill="none" stroke="#111111" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`,
  },
  {
    id: 'face-multistroke',
    title: 'Face Multi-Stroke Icon',
    image: {
      path: 'face-multistroke.svg',
      width: WIDTH,
      height: HEIGHT,
      mimeType: 'image/svg+xml',
      transparent: false,
    },
    expected: {
      shapeKind: 'face-icon',
      closed: true,
      strokeCount: 4,
      normalizedOutline: [
        [0.5, 0.16],
        [0.74, 0.25],
        [0.84, 0.5],
        [0.74, 0.75],
        [0.5, 0.84],
        [0.26, 0.75],
        [0.16, 0.5],
        [0.26, 0.25],
        [0.5, 0.16],
      ],
      characteristics: ['outer closed head loop', 'two separate eye strokes', 'separate curved mouth stroke'],
    },
    catches:
      'Checks that multi-stroke icon recognition keeps internal features as separate strokes while preserving the outer silhouette.',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="192" height="192" fill="#ffffff"/>
  <circle cx="96" cy="96" r="64" fill="none" stroke="#111111" stroke-width="12"/>
  <circle cx="73" cy="78" r="8" fill="#111111"/>
  <circle cx="119" cy="78" r="8" fill="#111111"/>
  <path d="M62 112 Q96 145 130 112" fill="none" stroke="#111111" stroke-width="10" stroke-linecap="round"/>
</svg>
`,
  },
  {
    id: 'transparent-icon',
    title: 'High Contrast Transparent PNG',
    image: {
      path: 'transparent-icon.png',
      width: WIDTH,
      height: HEIGHT,
      mimeType: 'image/png',
      transparent: true,
    },
    expected: {
      shapeKind: 'transparent-icon',
      closed: true,
      strokeCount: 1,
      normalizedOutline: [
        [0.5, 0.1],
        [0.86, 0.5],
        [0.5, 0.9],
        [0.14, 0.5],
        [0.5, 0.1],
      ],
      characteristics: ['transparent background', 'high-contrast black silhouette', 'white punched center'],
    },
    catches:
      'Checks alpha handling for icon-style PNG uploads so transparent backgrounds do not become part of the recognized shape.',
  },
];

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);

  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);

  return chunk;
}

function pointInDiamond(x, y) {
  return Math.abs(x - 96) + Math.abs(y - 96) <= 72;
}

function pointInCenterCutout(x, y) {
  return Math.abs(x - 96) + Math.abs(y - 96) <= 28;
}

function createTransparentIconPng() {
  const stride = 1 + WIDTH * CHANNELS_PER_PIXEL;
  const raw = Buffer.alloc(HEIGHT * stride);

  for (let y = 0; y < HEIGHT; y += 1) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0;

    for (let x = 0; x < WIDTH; x += 1) {
      const pixelOffset = rowOffset + 1 + x * CHANNELS_PER_PIXEL;
      const isShape = pointInDiamond(x, y);
      const isCutout = pointInCenterCutout(x, y);

      raw[pixelOffset] = isCutout ? 255 : 0;
      raw[pixelOffset + 1] = isCutout ? 255 : 0;
      raw[pixelOffset + 2] = isCutout ? 255 : 0;
      raw[pixelOffset + 3] = isShape ? 255 : 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = PNG_BIT_DEPTH;
  ihdr[9] = PNG_COLOR_TYPE_RGBA;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', deflateSync(raw)),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeManifest() {
  const manifest = {
    version: 1,
    generatedBy: 'scripts/generate-image-recognition-fixtures.mjs',
    fixtures: fixtures.map(({ svg, ...fixture }) => fixture),
  };

  writeFileSync(path.join(FIXTURE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeReadme() {
  const lines = [
    '# Image Recognition Fixtures',
    '',
    'Deterministic fixtures for future image recognizability tests. Regenerate with:',
    '',
    '```bash',
    'node scripts/generate-image-recognition-fixtures.mjs',
    '```',
    '',
    'Each manifest entry includes normalized outline metadata in `[0, 1]` image space and a short note describing what the fixture is meant to catch.',
    '',
    '## Fixtures',
    '',
    ...fixtures.flatMap((fixture) => [
      `- \`${fixture.id}\` (${fixture.image.path}): ${fixture.catches}`,
    ]),
    '',
  ];

  writeFileSync(path.join(FIXTURE_DIR, 'README.md'), `${lines.join('\n')}`);
}

mkdirSync(FIXTURE_DIR, { recursive: true });

for (const fixture of fixtures) {
  if (fixture.svg) {
    writeFileSync(path.join(FIXTURE_DIR, fixture.image.path), fixture.svg);
  }
}

writeFileSync(path.join(FIXTURE_DIR, 'transparent-icon.png'), createTransparentIconPng());
writeManifest();
writeReadme();
