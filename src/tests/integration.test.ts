import { describe, it, expect, vi } from 'vitest';
import { adaptiveSimplify, generateNormalizedHeart, SHAPE_SIMPLIFICATION_CONFIG } from '../lib/shapeMath';
import { buildStageScript } from '../lib/stageService';
import { RoutingService } from '../services/routingService';
import { findBestOrientation } from '../services/optimizationService';

// Mocking external services if needed, but for integration we want to test logic
// We'll use mock data for the network to avoid real API calls in this test suite

describe('GPS Art Integration Suite', () => {
  
  it('System 1: Shape Preprocessing (Simplification)', () => {
    const heart = generateNormalizedHeart(100);
    const config = SHAPE_SIMPLIFICATION_CONFIG.heart;
    const result = adaptiveSimplify(heart, config);
    
    expect(result.points.length).toBeGreaterThan(config.minSegments);
    expect(result.points.length).toBeLessThanOrEqual(config.targetSegments + 1);
    expect(result.points[0]).toEqual(heart[0]);
  });

  it('System 2: Stage Script Generation', () => {
    const points = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.0 }, // North
      { x: 1.0, y: 0.0 }, // East
    ];
    const stages = buildStageScript(points, 5);
    
    expect(stages.length).toBe(2);
    expect(stages[0].compassLabel).toBe('N');
    expect(stages[1].compassLabel).toBe('E');
  });

  it('System 3: Orientation Optimization', async () => {
    const heart = generateNormalizedHeart(20);
    const simplified = adaptiveSimplify(heart, SHAPE_SIMPLIFICATION_CONFIG.heart).points;
    
    const mockNodes = new Map([
      ['1', { id: 1, lat: 40.7128, lng: -74.006 }],
      ['2', { id: 2, lat: 40.7138, lng: -74.006 }],
    ]);
    const mockEdges = new Map([
      ['1', ['2']],
      ['2', ['1']],
    ]);

    const result = await findBestOrientation(
      simplified,
      40.7128,
      -74.006,
      5,
      mockNodes,
      mockEdges,
      'shapes'
    );

    expect(result.bestConfig).toBeDefined();
    expect(result.bestConfig.score).toBeGreaterThanOrEqual(0);
    expect(result.bestConfig.projectedPoints.length).toBe(simplified.length);
  });

  it('System 4: Locked Routing Logic', () => {
    const routingService = new RoutingService();
    const mockNodes = new Map([
      ['1', { lat: 40.7128, lng: -74.006 }],
      ['2', { lat: 40.7138, lng: -74.006 }],
    ]);
    
    const anchors = [
      { lat: 40.7138, lng: -74.006, stageIndex: 0 } // Anchor at node 2
    ];

    const locked = routingService.lockAnchorPointsToNodes(anchors, mockNodes);
    expect(locked[0].lockedNodeId).toBe('2');
    expect(locked[0].snapDistanceM).toBeLessThan(1);

    const geminiStages = [
      { stageIndex: 0, nodeIds: ['1', '2'] }
    ];
    
    const waypoints = routingService.buildOSRMWaypointArray(geminiStages, locked, mockNodes);
    expect(waypoints.length).toBe(2);
    expect(waypoints[0].lat).toBe(40.7128);
    expect(waypoints[1].isLocked).toBe(true);
    expect(waypoints[1].lat).toBe(40.7138);
  });
});
