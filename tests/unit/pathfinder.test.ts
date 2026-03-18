import { describe, it, expect } from 'vitest';
import { findPath, isPassable, isSolid, isHazard, canStandAt } from '../../src/world/pathfinder';
import { ChunkManager } from '../../src/world/chunkManager';

// ─── Mock ChunkManager ──────────────────────────────────────────────────

/** Create a ChunkManager-like object with a custom block lookup. */
function mockChunks(blockAt: (x: number, y: number, z: number) => string | null): ChunkManager {
  return { getBlockAt: blockAt } as any;
}

/** Flat world: solid at y=-1, air at y=0 and above. */
function flatWorld(): ChunkManager {
  return mockChunks((x, y, z) => {
    if (y < 0) return 'stone';
    return 'air';
  });
}

/** Flat world with a wall of stone at x=3, z=-2..2, y=0..1 (blocks feet+head). */
function worldWithWall(): ChunkManager {
  return mockChunks((x, y, z) => {
    if (y < 0) return 'stone';
    if (x === 3 && z >= -2 && z <= 2 && (y === 0 || y === 1)) return 'stone'; // wall
    return 'air';
  });
}

/** World with a 1-block step-up at x=3. */
function worldWithStep(): ChunkManager {
  return mockChunks((x, y, z) => {
    if (y < 0) return 'stone';
    if (x >= 3 && y === 0) return 'stone'; // raised platform
    return 'air';
  });
}

/** World with a 2-block drop at x=3. */
function worldWithDrop(): ChunkManager {
  return mockChunks((x, y, z) => {
    if (x < 3 && y < 0) return 'stone';    // ground level at y=-1
    if (x >= 3 && y < -2) return 'stone';   // ground 2 blocks lower
    return 'air';
  });
}

/** World with lava at x=3, z=-2..2. */
function worldWithLava(): ChunkManager {
  return mockChunks((x, y, z) => {
    if (y < 0) return 'stone';
    if (x === 3 && z >= -2 && z <= 2 && y === 0) return 'lava';
    return 'air';
  });
}

/** World with no chunk data (returns null). */
function unknownWorld(): ChunkManager {
  return mockChunks(() => null);
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('pathfinder', () => {
  describe('block classification', () => {
    it('classifies air as passable', () => {
      expect(isPassable('air')).toBe(true);
    });

    it('classifies stone as not passable', () => {
      expect(isPassable('stone')).toBe(false);
    });

    it('classifies null as not passable', () => {
      expect(isPassable(null)).toBe(false);
    });

    it('classifies stone as solid', () => {
      expect(isSolid('stone')).toBe(true);
    });

    it('classifies air as not solid', () => {
      expect(isSolid('air')).toBe(false);
    });

    it('classifies lava as hazard', () => {
      expect(isHazard('lava')).toBe(true);
    });

    it('classifies flowers as passable', () => {
      expect(isPassable('dandelion')).toBe(true);
      expect(isPassable('poppy')).toBe(true);
    });

    it('classifies water as passable', () => {
      expect(isPassable('water')).toBe(true);
    });

    it('classifies torches as passable', () => {
      expect(isPassable('torch')).toBe(true);
    });
  });

  describe('canStandAt', () => {
    it('can stand on solid block with air above', () => {
      const chunks = flatWorld();
      expect(canStandAt(chunks, 0, 0, 0)).toBe(true);
    });

    it('cannot stand in mid-air', () => {
      const chunks = mockChunks(() => 'air');
      expect(canStandAt(chunks, 0, 0, 0)).toBe(false);
    });

    it('cannot stand in solid block', () => {
      const chunks = mockChunks(() => 'stone');
      expect(canStandAt(chunks, 0, 0, 0)).toBe(false);
    });

    it('cannot stand on lava', () => {
      const chunks = mockChunks((x, y, z) => {
        if (y === -1) return 'lava';
        return 'air';
      });
      expect(canStandAt(chunks, 0, 0, 0)).toBe(false);
    });

    it('cannot stand with unknown blocks', () => {
      const chunks = unknownWorld();
      expect(canStandAt(chunks, 0, 0, 0)).toBe(false);
    });
  });

  describe('findPath', () => {
    it('returns empty path when already at goal', () => {
      const path = findPath(flatWorld(), 0, 0, 0, 0, 0, 0);
      expect(path).toEqual([]);
    });

    it('finds straight path on flat terrain', () => {
      const path = findPath(flatWorld(), 0, 0, 0, 5, 0, 0);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
      // Last waypoint should be at or near goal
      const last = path![path!.length - 1];
      expect(Math.abs(last.x - 5)).toBeLessThanOrEqual(1);
    });

    it('finds path around a wall', () => {
      const path = findPath(worldWithWall(), 0, 0, 0, 5, 0, 0);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
      // Path should not go through x=3, z=-2..2 at y=0 (that's the wall)
      for (const node of path!) {
        if (node.x === 3 && node.y === 0 && node.z >= -2 && node.z <= 2) {
          // This would mean walking through the wall — fail
          expect(true).toBe(false);
        }
      }
    });

    it('finds path with step-up', () => {
      const path = findPath(worldWithStep(), 0, 0, 0, 5, 1, 0);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
      // Path should go up to y=1 at some point
      const hasStepUp = path!.some(n => n.y === 1);
      expect(hasStepUp).toBe(true);
    });

    it('finds path with safe drop', () => {
      const path = findPath(worldWithDrop(), 0, 0, 0, 5, -2, 0);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
    });

    it('avoids lava', () => {
      const path = findPath(worldWithLava(), 0, 0, 0, 5, 0, 0);
      expect(path).not.toBeNull();
      // Path should not step on lava (at x=3, z=-2..2)
      for (const node of path!) {
        if (node.x === 3 && node.y === 0 && node.z >= -2 && node.z <= 2) {
          // Would be on the lava block
          expect(true).toBe(false);
        }
      }
    });

    it('returns null when no chunk data available', () => {
      const path = findPath(unknownWorld(), 0, 0, 0, 5, 0, 0);
      expect(path).toBeNull();
    });

    it('handles diagonal movement', () => {
      const path = findPath(flatWorld(), 0, 0, 0, 3, 0, 3);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
      // Should use some diagonal moves (path shorter than manhattan distance)
      expect(path!.length).toBeLessThanOrEqual(4);
    });

    it('returns null for unreachable goal (surrounded by walls)', () => {
      const chunks = mockChunks((x, y, z) => {
        if (y < 0) return 'stone';
        // Box of walls around (10, 0, 10)
        if (x >= 9 && x <= 11 && z >= 9 && z <= 11 && (y === 0 || y === 1)) {
          if (x === 10 && z === 10) return 'air'; // inside is air
          return 'stone'; // walls
        }
        return 'air';
      });
      const path = findPath(chunks, 0, 0, 0, 10, 0, 10);
      expect(path).toBeNull();
    });

    it('does not exceed max path length', () => {
      // Goal very far away — should still terminate
      const path = findPath(flatWorld(), 0, 0, 0, 200, 0, 0);
      // Either null (budget exceeded) or a capped path
      if (path !== null) {
        expect(path.length).toBeLessThanOrEqual(150);
      }
    });
  });
});
