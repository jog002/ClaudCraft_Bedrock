/**
 * A* pathfinder using ChunkManager for block collision.
 *
 * Finds walkable paths through 3D space by checking actual block data.
 * Supports step-ups (1-block jumps), safe drops (up to 3 blocks),
 * and hazard avoidance (lava, fire, cactus).
 */
import { ChunkManager } from './chunkManager';

// ─── Types ──────────────────────────────────────────────────────────────

export interface PathNode {
  x: number;
  y: number;
  z: number;
}

interface AStarNode {
  x: number;
  y: number;
  z: number;
  g: number; // cost from start
  h: number; // heuristic to goal
  f: number; // g + h
  parent: AStarNode | null;
}

// ─── Block Classification ───────────────────────────────────────────────

const PASSABLE_BLOCKS = new Set([
  'air', 'cave_air', 'void_air',
  'tall_grass', 'short_grass', 'grass', 'fern', 'large_fern',
  'dead_bush', 'seagrass', 'tall_seagrass',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'sunflower',
  'lilac', 'rose_bush', 'peony', 'wither_rose',
  'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch',
  'redstone_torch', 'redstone_wall_torch',
  'sign', 'wall_sign', 'hanging_sign',
  'rail', 'powered_rail', 'detector_rail', 'activator_rail',
  'snow_layer', 'carpet',
  'vine', 'glow_lichen',
  'button', 'lever',
  'pressure_plate', 'light_weighted_pressure_plate', 'heavy_weighted_pressure_plate',
  'tripwire', 'tripwire_hook',
  'redstone_wire',
  'sugar_cane', 'kelp', 'bamboo_sapling',
  'structure_void', 'barrier',
  'cobweb', // passable but slow — still walkable
]);

const HAZARD_BLOCKS = new Set([
  'lava', 'flowing_lava',
  'fire', 'soul_fire',
  'cactus',
  'sweet_berry_bush',
  'magma_block',
  'campfire', 'soul_campfire',
  'wither_rose',
  'powder_snow',
]);

const CLIMBABLE_BLOCKS = new Set([
  'ladder', 'vine', 'scaffolding',
  'twisting_vines', 'weeping_vines',
]);

// ─── Helpers ────────────────────────────────────────────────────────────

function isPassable(block: string | null): boolean {
  if (block === null) return false; // unknown = assume blocked
  if (block === 'air') return true;
  if (PASSABLE_BLOCKS.has(block)) return true;
  // Liquids: water is passable (though slow)
  if (block === 'water' || block === 'flowing_water') return true;
  return false;
}

function isSolid(block: string | null): boolean {
  if (block === null) return false; // unknown = can't stand on it
  if (block === 'air') return false;
  if (PASSABLE_BLOCKS.has(block)) return false;
  if (block === 'water' || block === 'flowing_water') return false;
  if (block === 'lava' || block === 'flowing_lava') return false;
  return true; // assume solid
}

function isHazard(block: string | null): boolean {
  if (block === null) return false;
  return HAZARD_BLOCKS.has(block);
}

function isClimbable(block: string | null): boolean {
  if (block === null) return false;
  return CLIMBABLE_BLOCKS.has(block);
}

function heuristic(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  // 3D Chebyshev distance (allows diagonal movement)
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

function nodeKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

// ─── Pathfinder ─────────────────────────────────────────────────────────

const MAX_ITERATIONS = 2000;
const MAX_FALL_DISTANCE = 3;
const MAX_PATH_LENGTH = 100;

/**
 * Find a path from start to goal using A* with block collision.
 *
 * Returns an array of waypoints (block positions), or null if:
 * - No path exists within iteration budget
 * - Chunk data is unavailable for the area
 *
 * The path includes step-ups (1-block jumps) and safe drops.
 */
export function findPath(
  chunks: ChunkManager,
  startX: number, startY: number, startZ: number,
  goalX: number, goalY: number, goalZ: number,
): PathNode[] | null {
  // Round to block positions
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  const sz = Math.floor(startZ);
  const gx = Math.floor(goalX);
  const gy = Math.floor(goalY);
  const gz = Math.floor(goalZ);

  // Quick check: is chunk data available at start?
  const startBlock = chunks.getBlockAt(sx, sy - 1, sz);
  if (startBlock === null) return null; // no chunk data

  // Already at goal
  if (sx === gx && sy === gy && sz === gz) return [];

  const startNode: AStarNode = {
    x: sx, y: sy, z: sz,
    g: 0,
    h: heuristic(sx, sy, sz, gx, gy, gz),
    f: heuristic(sx, sy, sz, gx, gy, gz),
    parent: null,
  };

  // Open set as a simple sorted array (good enough for ~2000 nodes)
  const open: AStarNode[] = [startNode];
  const closed = new Set<string>();
  const gScores = new Map<string, number>();
  gScores.set(nodeKey(sx, sy, sz), 0);

  // Cardinal + diagonal neighbors (XZ plane)
  const neighbors = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
    { dx: 1, dz: 1 },
    { dx: 1, dz: -1 },
    { dx: -1, dz: 1 },
    { dx: -1, dz: -1 },
  ];

  let iterations = 0;

  while (open.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;

    // Find node with lowest f score
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open[bestIdx];
    open.splice(bestIdx, 1);

    // Goal reached (within 1 block XZ, same Y level or close)
    if (Math.abs(current.x - gx) <= 1 && Math.abs(current.z - gz) <= 1 && Math.abs(current.y - gy) <= 1) {
      return reconstructPath(current);
    }

    const currentKey = nodeKey(current.x, current.y, current.z);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    // Path too long
    if (current.g > MAX_PATH_LENGTH) continue;

    for (const { dx, dz } of neighbors) {
      const nx = current.x + dx;
      const nz = current.z + dz;

      // Try same level, step-up (+1), and drops (down 1-3)
      const candidates = getWalkableCandidates(chunks, current.x, current.y, current.z, nx, nz);

      for (const ny of candidates) {
        const nKey = nodeKey(nx, ny, nz);
        if (closed.has(nKey)) continue;

        // Movement cost: 1 for cardinal, 1.41 for diagonal, +0.5 for jump, +0.2 per drop block
        const isDiagonal = dx !== 0 && dz !== 0;
        let moveCost = isDiagonal ? 1.414 : 1.0;
        const yDiff = ny - current.y;
        if (yDiff === 1) moveCost += 0.5; // step-up penalty
        if (yDiff < 0) moveCost += Math.abs(yDiff) * 0.2; // drop penalty

        // Water penalty
        const feetBlock = chunks.getBlockAt(nx, ny, nz);
        if (feetBlock === 'water' || feetBlock === 'flowing_water') moveCost += 2.0;

        const tentativeG = current.g + moveCost;
        const existingG = gScores.get(nKey);
        if (existingG !== undefined && tentativeG >= existingG) continue;

        gScores.set(nKey, tentativeG);
        const h = heuristic(nx, ny, nz, gx, gy, gz);
        open.push({
          x: nx, y: ny, z: nz,
          g: tentativeG,
          h,
          f: tentativeG + h,
          parent: current,
        });
      }
    }
  }

  return null; // no path found
}

/**
 * Get valid Y positions the bot can move to at (nx, nz) from (cx, cy, cz).
 * Checks: same level, step-up, drops, and ladders.
 */
function getWalkableCandidates(
  chunks: ChunkManager,
  cx: number, cy: number, cz: number,
  nx: number, nz: number,
): number[] {
  const results: number[] = [];

  // Check same level
  if (canStandAt(chunks, nx, cy, nz) && canPassThrough(chunks, cx, cy, cz, nx, cy, nz)) {
    results.push(cy);
  }

  // Check step-up (+1): need to be able to stand at ny=cy+1, and head clearance at old pos
  const stepUpY = cy + 1;
  if (canStandAt(chunks, nx, stepUpY, nz)) {
    // Need clearance above current head (cy+2)
    const aboveHead = chunks.getBlockAt(cx, cy + 2, cz);
    if (isPassable(aboveHead) && canPassThrough(chunks, cx, cy, cz, nx, stepUpY, nz)) {
      results.push(stepUpY);
    }
  }

  // Check drops (1-3 blocks down)
  for (let drop = 1; drop <= MAX_FALL_DISTANCE; drop++) {
    const dropY = cy - drop;
    if (dropY < -64) break; // void

    if (canStandAt(chunks, nx, dropY, nz)) {
      // Make sure all blocks in the fall column are passable
      let canFall = true;
      for (let fy = cy; fy > dropY; fy--) {
        const fallBlock = chunks.getBlockAt(nx, fy, nz);
        const fallHead = chunks.getBlockAt(nx, fy + 1, nz);
        if (!isPassable(fallBlock) || !isPassable(fallHead)) {
          canFall = false;
          break;
        }
      }
      if (canFall) {
        results.push(dropY);
        break; // take first valid drop
      }
    }
  }

  // Check ladder/vine climbing (up)
  const aboveFeet = chunks.getBlockAt(nx, cy + 1, nz);
  if (isClimbable(aboveFeet)) {
    // Can climb up, check if can stand 2 above
    if (canStandAt(chunks, nx, cy + 2, nz)) {
      results.push(cy + 2);
    }
  }

  return results;
}

/**
 * Check if a bot can stand at position (x, y, z):
 * - Block below (y-1) must be solid
 * - Block at feet (y) must be passable and not hazardous
 * - Block at head (y+1) must be passable
 */
function canStandAt(chunks: ChunkManager, x: number, y: number, z: number): boolean {
  const below = chunks.getBlockAt(x, y - 1, z);
  if (!isSolid(below)) return false;
  if (isHazard(below)) return false; // don't stand on magma, campfire etc.

  const feet = chunks.getBlockAt(x, y, z);
  if (!isPassable(feet)) return false;
  if (isHazard(feet)) return false;

  const head = chunks.getBlockAt(x, y + 1, z);
  if (!isPassable(head)) return false;

  return true;
}

/**
 * Check if the bot can pass from (cx, cy, cz) to (nx, ny, nz).
 * For diagonal moves, also checks both cardinal intermediaries
 * to prevent corner-cutting through walls.
 */
function canPassThrough(
  chunks: ChunkManager,
  cx: number, cy: number, cz: number,
  nx: number, ny: number, nz: number,
): boolean {
  const dx = nx - cx;
  const dz = nz - cz;

  // Diagonal: check both intermediate positions
  if (dx !== 0 && dz !== 0) {
    // Check (cx+dx, cy, cz) and (cx, cy, cz+dz) — the two cardinal intermediaries
    const midA_feet = chunks.getBlockAt(cx + dx, cy, cz);
    const midA_head = chunks.getBlockAt(cx + dx, cy + 1, cz);
    const midB_feet = chunks.getBlockAt(cx, cy, cz + dz);
    const midB_head = chunks.getBlockAt(cx, cy + 1, cz + dz);

    if (!isPassable(midA_feet) || !isPassable(midA_head)) return false;
    if (!isPassable(midB_feet) || !isPassable(midB_head)) return false;
  }

  return true;
}

/**
 * Reconstruct path from goal node back to start.
 */
function reconstructPath(node: AStarNode): PathNode[] {
  const path: PathNode[] = [];
  let current: AStarNode | null = node;
  while (current !== null) {
    path.push({ x: current.x, y: current.y, z: current.z });
    current = current.parent;
  }
  path.reverse();
  // Remove the start node (bot is already there)
  if (path.length > 0) path.shift();
  return path;
}

// ─── Exports for testing ────────────────────────────────────────────────

export { isPassable, isSolid, isHazard, canStandAt };
