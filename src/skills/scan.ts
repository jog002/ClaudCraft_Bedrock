/**
 * World scanning skills — scanNearby and deepScan.
 *
 * scanNearby: Scans a ~48-block radius around the bot for notable blocks
 *   (ores, containers, hazards). Uses currently loaded chunk data.
 *
 * deepScan: Scans ALL loaded chunks for specific targets (diamond ore, chests,
 *   spawners, etc.). Optionally requests more chunks from server first.
 *   Essentially X-ray vision as a tool.
 */
import { Action, ActionResult, SkillContext } from './types';
import { BlockHit } from '../world/chunkManager';

// ─── scanNearby ─────────────────────────────────────────────────────────

export async function executeScanNearby(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'scanNearby') {
    return { success: false, message: 'Invalid action type', actionType: 'scanNearby' };
  }

  const radius = (action as any).radius ?? 24;
  const pos = ctx.worldState.bot.position;

  const hits = ctx.worldState.chunkManager.scanArea(
    pos.x, pos.y, pos.z,
    Math.min(radius, 48) // cap at 48 blocks
  );

  if (hits.length === 0) {
    return {
      success: true,
      message: `Scanned ${radius}-block radius: nothing notable found. ${ctx.worldState.chunkManager.chunkCount} chunks loaded.`,
      actionType: 'scanNearby',
    };
  }

  // Group hits by category and summarize
  const summary = formatScanResults(hits, 30);

  return {
    success: true,
    message: `Scanned ${radius}-block radius:\n${summary}`,
    actionType: 'scanNearby',
  };
}

// ─── deepScan ───────────────────────────────────────────────────────────

export async function executeDeepScan(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'deepScan') {
    return { success: false, message: 'Invalid action type', actionType: 'deepScan' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'deepScan' };
  }

  const pos = ctx.worldState.bot.position;
  const filter = (action as any).filter
    ? (action as any).filter.split(',').map((s: string) => s.trim().toLowerCase())
    : undefined;

  const c = client as any;

  // Temporarily expand render distance to load more chunks
  const DEEP_SCAN_RADIUS = 8; // 8 chunks = ~128 block radius
  const NORMAL_RADIUS = 4;
  try {
    c.queue('request_chunk_radius', { chunk_radius: DEEP_SCAN_RADIUS, max_radius: DEEP_SCAN_RADIUS });
  } catch {
    // Non-fatal
  }

  // Request subchunks around the bot to fill in data
  const dim = ctx.worldState.bot.dimension === 'nether' ? 1
    : ctx.worldState.bot.dimension === 'the end' ? 2 : 0;

  try {
    await ctx.worldState.chunkManager.requestSubchunks(
      client, pos.x, pos.y, pos.z, DEEP_SCAN_RADIUS, dim
    );
  } catch {
    // Non-fatal — scan whatever we already have
  }

  // Wait for chunk data to arrive from server
  await sleep(3000);

  // Restore normal render distance
  try {
    c.queue('request_chunk_radius', { chunk_radius: NORMAL_RADIUS, max_radius: NORMAL_RADIUS });
  } catch {
    // Non-fatal
  }

  const hits = ctx.worldState.chunkManager.deepScan(pos.x, pos.y, pos.z, filter);

  if (hits.length === 0) {
    const filterStr = filter ? ` matching "${filter.join(', ')}"` : '';
    return {
      success: true,
      message: `Deep scan complete: no notable blocks found${filterStr}. Scanned ${ctx.worldState.chunkManager.chunkCount} chunks.`,
      actionType: 'deepScan',
    };
  }

  // Group and format
  const summary = formatScanResults(hits, 50);

  return {
    success: true,
    message: `Deep scan complete (${ctx.worldState.chunkManager.chunkCount} chunks):\n${summary}`,
    actionType: 'deepScan',
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────

function formatScanResults(hits: BlockHit[], maxEntries: number): string {
  // Group by block type
  const groups = new Map<string, BlockHit[]>();
  for (const hit of hits) {
    const existing = groups.get(hit.name) ?? [];
    existing.push(hit);
    groups.set(hit.name, existing);
  }

  const lines: string[] = [];
  // Sort groups: ores first (by rarity), then containers, then hazards
  const priority: Record<string, number> = {
    ancient_debris: 0, diamond_ore: 1, emerald_ore: 2, gold_ore: 3,
    lapis_ore: 4, redstone_ore: 5, iron_ore: 6, copper_ore: 7, coal_ore: 8,
    spawner: 10, chest: 11, trapped_chest: 12, barrel: 13,
    ender_chest: 14, shulker_box: 15,
    enchanting_table: 20, brewing_stand: 21, anvil: 22,
    crafting_table: 23, furnace: 24, smithing_table: 25, grindstone: 26,
    end_portal_frame: 30, end_portal: 31, nether_portal: 32,
    obsidian: 40, beacon: 41, bed: 42,
    lava: 50,
  };

  const sorted = [...groups.entries()].sort(
    (a, b) => (priority[a[0]] ?? 99) - (priority[b[0]] ?? 99)
  );

  let entryCount = 0;
  for (const [name, blockHits] of sorted) {
    if (entryCount >= maxEntries) {
      lines.push(`... and ${hits.length - entryCount} more`);
      break;
    }

    if (blockHits.length <= 3) {
      // List individual positions
      for (const h of blockHits) {
        lines.push(`- ${name} at (${h.x}, ${h.y}, ${h.z}) [${h.dist.toFixed(0)} blocks]`);
        entryCount++;
      }
    } else {
      // Summarize: count + closest 3
      const closest = blockHits.slice(0, 3);
      const positions = closest.map(h => `(${h.x},${h.y},${h.z})`).join(', ');
      lines.push(`- ${name} x${blockHits.length} — closest: ${positions} [${closest[0].dist.toFixed(0)} blocks]`);
      entryCount++;
    }
  }

  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
