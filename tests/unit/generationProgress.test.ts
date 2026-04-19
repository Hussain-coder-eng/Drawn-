import { describe, it, expect } from 'vitest';
import { messageToStepIndex } from '../../src/components/GenerationProgress';

describe('messageToStepIndex', () => {
  it('maps road/fetch messages to step 0', () => {
    expect(messageToStepIndex('Fetching local road network...')).toBe(0);
    expect(messageToStepIndex('Using cached road network...')).toBe(0);
    expect(messageToStepIndex('Processing map data in background...')).toBe(0);
  });
  it('maps orientation messages to step 1', () => {
    expect(messageToStepIndex('Optimizing orientation...')).toBe(1);
  });
  it('maps node/AI/laying-out messages to step 2', () => {
    expect(messageToStepIndex('Laying out your Circle — attempt 1 of 3...')).toBe(2);
    expect(messageToStepIndex('Selecting route nodes — contacting AI...')).toBe(2);
    expect(messageToStepIndex('Asking Gemini...')).toBe(2);
  });
  it('maps routing messages to step 3', () => {
    expect(messageToStepIndex('Routing on real streets...')).toBe(3);
  });
  it('maps scoring messages to step 4', () => {
    expect(messageToStepIndex('Scoring & refining...')).toBe(4);
  });
  it('returns -1 for unrecognized messages', () => {
    expect(messageToStepIndex('')).toBe(-1);
    expect(messageToStepIndex('Preprocessing your design...')).toBe(-1);
  });
});
