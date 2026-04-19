import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGoogleMapsUrl, buildAppleMapsUrl, copyMapsLink, calculateRouteDistanceKm } from '../../src/lib/mapsExport';
import { Point } from '../../src/lib/shapeMath';

function pts(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ lat: 51.5 + i * 0.001, lng: -0.1 + i * 0.001 }));
}

describe('buildGoogleMapsUrl', () => {
  it('returns empty string for fewer than 2 waypoints', () => {
    expect(buildGoogleMapsUrl([])).toBe('');
    expect(buildGoogleMapsUrl([{ lat: 51.5, lng: -0.1 }])).toBe('');
  });

  it('includes origin, destination, and walking mode', () => {
    const url = buildGoogleMapsUrl(pts(3));
    expect(url).toContain('origin=51.5,-0.1');
    expect(url).toContain('travelmode=walking');
    expect(url).toContain('google.com/maps/dir');
  });

  it('subsamples to at most 8 intermediate waypoints (10 total)', () => {
    const url = buildGoogleMapsUrl(pts(20));
    const match = url.match(/waypoints=([^&]+)/);
    expect(match).not.toBeNull();
    const count = decodeURIComponent(match![1]).split('|').length;
    expect(count).toBeLessThanOrEqual(8);
  });

  it('works with exactly 2 waypoints (no intermediate)', () => {
    const url = buildGoogleMapsUrl(pts(2));
    expect(url).not.toContain('waypoints');
    expect(url).toContain('origin=');
    expect(url).toContain('destination=');
  });
});

describe('buildAppleMapsUrl', () => {
  it('returns empty string for fewer than 2 waypoints', () => {
    expect(buildAppleMapsUrl([])).toBe('');
  });

  it('includes saddr, daddr, and walking mode', () => {
    const url = buildAppleMapsUrl(pts(10));
    expect(url).toContain('maps://?saddr=51.5,-0.1');
    expect(url).toContain('dirflg=w');
  });

  it('chains multiple stops via +to: for routes with many waypoints', () => {
    const url = buildAppleMapsUrl(pts(20));
    expect(url).toContain('+to:');
  });

  it('works with exactly 2 waypoints (no chaining needed)', () => {
    const url = buildAppleMapsUrl(pts(2));
    expect(url).toContain('saddr=');
    expect(url).toContain('daddr=');
    expect(url).not.toContain('+to:');
  });
});

describe('calculateRouteDistanceKm', () => {
  it('returns 0 for fewer than 2 points', () => {
    expect(calculateRouteDistanceKm([])).toBe(0);
    expect(calculateRouteDistanceKm([{ lat: 51.5, lng: -0.1 }])).toBe(0);
  });

  it('returns a positive distance for 2 separated points', () => {
    const dist = calculateRouteDistanceKm([
      { lat: 51.5, lng: -0.1 },
      { lat: 51.51, lng: -0.1 },
    ]);
    // ~1.11 km per 0.01 degree latitude
    expect(dist).toBeGreaterThan(1.0);
    expect(dist).toBeLessThan(1.3);
  });

  it('sums multiple segments', () => {
    const single = calculateRouteDistanceKm([
      { lat: 51.5, lng: -0.1 },
      { lat: 51.52, lng: -0.1 },
    ]);
    const two = calculateRouteDistanceKm([
      { lat: 51.5, lng: -0.1 },
      { lat: 51.51, lng: -0.1 },
      { lat: 51.52, lng: -0.1 },
    ]);
    expect(Math.abs(single - two)).toBeLessThan(0.001);
  });
});

describe('copyMapsLink', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
  });

  it('calls clipboard.writeText with the Google Maps URL', async () => {
    const waypoints = pts(3);
    await copyMapsLink(waypoints);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      buildGoogleMapsUrl(waypoints)
    );
  });

  it('does not call clipboard.writeText for fewer than 2 waypoints', async () => {
    await copyMapsLink([]);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});
