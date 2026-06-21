import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURE_DIR = path.resolve(process.cwd(), 'tests/fixtures/image-recognition');
const MANIFEST_PATH = path.join(FIXTURE_DIR, 'manifest.json');
const REQUIRED_FIXTURE_IDS = [
  'circle-loop',
  'star',
  'open-path',
  'face-multistroke',
  'transparent-icon',
] as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_DIMENSION_PX = 64;
const MAX_DIMENSION_PX = 1024;

type ManifestFixture = {
  id: string;
  image: {
    path: string;
    width: number;
    height: number;
    mimeType: string;
    transparent: boolean;
  };
  expected: {
    shapeKind: string;
    closed: boolean;
    strokeCount: number;
    normalizedOutline: Array<[number, number]>;
    characteristics: string[];
  };
  catches: string;
};

type Manifest = {
  version: number;
  generatedBy: string;
  fixtures: ManifestFixture[];
};

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}

function assertPngHasAlphaChannel(filePath: string): void {
  const bytes = readFileSync(filePath);
  expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

  const colorType = bytes[25];
  expect([4, 6]).toContain(colorType);
}

describe('image recognition fixture pack', () => {
  it('includes the required deterministic fixtures with valid metadata', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    const manifest = loadManifest();

    expect(manifest.version).toBe(1);
    expect(manifest.generatedBy).toBe('scripts/generate-image-recognition-fixtures.mjs');
    expect(manifest.fixtures.map((fixture) => fixture.id).sort()).toEqual(
      [...REQUIRED_FIXTURE_IDS].sort(),
    );

    for (const fixture of manifest.fixtures) {
      const imagePath = path.join(FIXTURE_DIR, fixture.image.path);

      expect(existsSync(imagePath), `${fixture.id} image should exist`).toBe(true);
      expect(fixture.image.width).toBeGreaterThanOrEqual(MIN_DIMENSION_PX);
      expect(fixture.image.height).toBeGreaterThanOrEqual(MIN_DIMENSION_PX);
      expect(fixture.image.width).toBeLessThanOrEqual(MAX_DIMENSION_PX);
      expect(fixture.image.height).toBeLessThanOrEqual(MAX_DIMENSION_PX);
      expect(fixture.expected.strokeCount).toBeGreaterThanOrEqual(1);
      expect(fixture.expected.normalizedOutline.length).toBeGreaterThanOrEqual(2);
      expect(fixture.expected.characteristics.length).toBeGreaterThanOrEqual(2);
      expect(fixture.catches.trim().length).toBeGreaterThan(20);

      for (const [x, y] of fixture.expected.normalizedOutline) {
        expect(x, `${fixture.id} normalized x`).toBeGreaterThanOrEqual(0);
        expect(x, `${fixture.id} normalized x`).toBeLessThanOrEqual(1);
        expect(y, `${fixture.id} normalized y`).toBeGreaterThanOrEqual(0);
        expect(y, `${fixture.id} normalized y`).toBeLessThanOrEqual(1);
      }

      if (fixture.image.mimeType === 'image/png') {
        assertPngHasAlphaChannel(imagePath);
        expect(fixture.image.transparent).toBe(true);
      }
    }
  });

  it('marks closed and open fixture expectations explicitly', () => {
    const manifest = loadManifest();
    const byId = new Map(manifest.fixtures.map((fixture) => [fixture.id, fixture]));

    expect(byId.get('circle-loop')?.expected.closed).toBe(true);
    expect(byId.get('star')?.expected.closed).toBe(true);
    expect(byId.get('open-path')?.expected.closed).toBe(false);
    expect(byId.get('face-multistroke')?.expected.strokeCount).toBeGreaterThan(1);
    expect(byId.get('transparent-icon')?.image.transparent).toBe(true);
  });
});
