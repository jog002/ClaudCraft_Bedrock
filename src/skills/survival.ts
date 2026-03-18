/**
 * Packet-level survival skills — no cheats/commands required.
 * Uses raw bedrock-protocol packets for movement, combat, mining, and building.
 */
import { Action, ActionResult, SkillContext } from './types';
import { findPath, PathNode } from '../world/pathfinder';

// ─── Movement ──────────────────────────────────────────────────────────

const WALK_SPEED = 4.317; // blocks per second (vanilla walking speed)
const STEP_INTERVAL_MS = 50; // send position updates every 50ms (20 ticks/sec)
const BLOCKS_PER_STEP = WALK_SPEED * (STEP_INTERVAL_MS / 1000);
const MAX_WALK_DISTANCE = 100; // cap walk distance to prevent runaway walks
const ARRIVAL_THRESHOLD = 1.5; // close enough

// Active walk state — only one walk at a time
let walkAbortController: AbortController | null = null;

function sendPosition(ctx: SkillContext, x: number, y: number, z: number, yaw: number, pitch: number): void {
  const client = ctx.connection.getClient();
  if (!client) return;

  ctx.worldState.bot.position = { x, y, z };
  ctx.worldState.bot.yaw = yaw;
  ctx.worldState.bot.pitch = pitch;

  client.queue('move_player' as any, {
    runtime_id: Number(ctx.worldState.getBotRuntimeId()),
    position: { x, y, z },
    pitch,
    yaw,
    head_yaw: yaw,
    mode: 'normal',
    on_ground: true,
    ridden_runtime_id: 0,
    tick: 0,
  });
}

function calcYaw(dx: number, dz: number): number {
  return -Math.atan2(dx, dz) * (180 / Math.PI);
}

const STUCK_CHECK_INTERVAL = 20; // check every N steps (~1 second)
const STUCK_THRESHOLD = 0.5; // if moved < 0.5 blocks in check interval, we're stuck

async function walkToPosition(
  ctx: SkillContext,
  tx: number, ty: number, tz: number,
  signal: AbortSignal
): Promise<{ arrived: boolean; distance: number; stuck: boolean }> {
  const start = ctx.worldState.bot.position;
  const totalDist = Math.sqrt((tx - start.x) ** 2 + (tz - start.z) ** 2);

  if (totalDist < ARRIVAL_THRESHOLD) {
    return { arrived: true, distance: 0, stuck: false };
  }

  // Try A* pathfinding first (requires chunk data)
  const path = findPath(
    ctx.worldState.chunkManager,
    start.x, start.y, start.z,
    tx, ty, tz,
  );

  if (path && path.length > 0) {
    return walkAlongPath(ctx, path, tx, ty, tz, signal);
  }

  // Fallback: straight-line walk (no chunk data available)
  return walkStraightLine(ctx, tx, ty, tz, signal);
}

/** Walk along an A* path, stepping between waypoints. */
async function walkAlongPath(
  ctx: SkillContext,
  path: PathNode[],
  goalX: number, _goalY: number, goalZ: number,
  signal: AbortSignal,
): Promise<{ arrived: boolean; distance: number; stuck: boolean }> {
  let lastCheckPos = { x: ctx.worldState.bot.position.x, z: ctx.worldState.bot.position.z };
  let stuckCount = 0;
  let totalSteps = 0;

  for (const waypoint of path) {
    if (signal.aborted) break;

    // Walk from current position to this waypoint
    const wpX = waypoint.x + 0.5; // center of block
    const wpZ = waypoint.z + 0.5;
    const wpY = waypoint.y;

    let cx = ctx.worldState.bot.position.x;
    let cz = ctx.worldState.bot.position.z;

    const dx = wpX - cx;
    const dz = wpZ - cz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.3) {
      // Already close enough to waypoint, just update Y
      const yaw = calcYaw(dx, dz);
      sendPosition(ctx, wpX, wpY, wpZ, yaw, 0);
      await sleep(STEP_INTERVAL_MS);
      continue;
    }

    const mag = Math.sqrt(dx * dx + dz * dz);
    const ux = dx / mag;
    const uz = dz / mag;
    const yaw = calcYaw(dx, dz);

    const stepsForWaypoint = Math.ceil(dist / BLOCKS_PER_STEP);

    for (let i = 0; i < stepsForWaypoint; i++) {
      if (signal.aborted) break;

      cx += ux * BLOCKS_PER_STEP;
      cz += uz * BLOCKS_PER_STEP;

      // Check overshoot
      const remaining = Math.sqrt((wpX - cx) ** 2 + (wpZ - cz) ** 2);
      if (remaining < 0.3) {
        sendPosition(ctx, wpX, wpY, wpZ, yaw, 0);
        await sleep(STEP_INTERVAL_MS);
        break;
      }

      // Interpolate Y toward waypoint
      const progress = (i + 1) / stepsForWaypoint;
      const iy = ctx.worldState.bot.position.y + (wpY - ctx.worldState.bot.position.y) * progress;

      sendPosition(ctx, cx, iy, cz, yaw, 0);
      await sleep(STEP_INTERVAL_MS);
      totalSteps++;

      // Stuck detection
      if (totalSteps % STUCK_CHECK_INTERVAL === 0) {
        const actual = ctx.worldState.bot.position;
        const moved = Math.sqrt(
          (actual.x - lastCheckPos.x) ** 2 + (actual.z - lastCheckPos.z) ** 2
        );
        if (moved < STUCK_THRESHOLD) {
          stuckCount++;
          if (stuckCount >= 2) {
            const finalDist = Math.sqrt(
              (goalX - actual.x) ** 2 + (goalZ - actual.z) ** 2
            );
            return { arrived: false, distance: finalDist, stuck: true };
          }
        } else {
          stuckCount = 0;
        }
        lastCheckPos = { x: actual.x, z: actual.z };
      }
    }
  }

  const finalDist = Math.sqrt(
    (goalX - ctx.worldState.bot.position.x) ** 2 +
    (goalZ - ctx.worldState.bot.position.z) ** 2
  );
  return { arrived: finalDist < ARRIVAL_THRESHOLD, distance: finalDist, stuck: false };
}

/** Straight-line walk — fallback when no chunk data is available. */
async function walkStraightLine(
  ctx: SkillContext,
  tx: number, ty: number, tz: number,
  signal: AbortSignal,
): Promise<{ arrived: boolean; distance: number; stuck: boolean }> {
  const start = ctx.worldState.bot.position;
  const dx = tx - start.x;
  const dz = tz - start.z;
  const mag = Math.sqrt(dx * dx + dz * dz);
  const ux = dx / mag;
  const uz = dz / mag;
  const yaw = calcYaw(dx, dz);

  let cx = start.x;
  let cz = start.z;
  const cy = ty;

  let stepsLeft = Math.ceil(mag / BLOCKS_PER_STEP);
  const maxSteps = Math.ceil(MAX_WALK_DISTANCE / BLOCKS_PER_STEP);
  stepsLeft = Math.min(stepsLeft, maxSteps);

  let lastCheckPos = { x: start.x, z: start.z };
  let stuckCount = 0;

  for (let i = 0; i < stepsLeft; i++) {
    if (signal.aborted) break;

    cx += ux * BLOCKS_PER_STEP;
    cz += uz * BLOCKS_PER_STEP;

    const remaining = Math.sqrt((tx - cx) ** 2 + (tz - cz) ** 2);
    if (remaining < ARRIVAL_THRESHOLD) {
      sendPosition(ctx, tx, cy, tz, yaw, 0);
      return { arrived: true, distance: 0, stuck: false };
    }

    sendPosition(ctx, cx, cy, cz, yaw, 0);
    await sleep(STEP_INTERVAL_MS);

    if ((i + 1) % STUCK_CHECK_INTERVAL === 0) {
      const actual = ctx.worldState.bot.position;
      const moved = Math.sqrt(
        (actual.x - lastCheckPos.x) ** 2 + (actual.z - lastCheckPos.z) ** 2
      );
      if (moved < STUCK_THRESHOLD) {
        stuckCount++;
        if (stuckCount >= 2) {
          const finalDist = Math.sqrt(
            (tx - actual.x) ** 2 + (tz - actual.z) ** 2
          );
          return { arrived: false, distance: finalDist, stuck: true };
        }
      } else {
        stuckCount = 0;
      }
      lastCheckPos = { x: actual.x, z: actual.z };
    }
  }

  const finalDist = Math.sqrt(
    (tx - ctx.worldState.bot.position.x) ** 2 +
    (tz - ctx.worldState.bot.position.z) ** 2
  );
  return { arrived: finalDist < ARRIVAL_THRESHOLD, distance: finalDist, stuck: false };
}

export async function executeSurvivalWalkTo(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'walkTo') {
    return { success: false, message: 'Invalid action type', actionType: 'walkTo' };
  }

  // Cancel any existing walk
  if (walkAbortController) {
    walkAbortController.abort();
    walkAbortController = null;
  }

  const { x, y, z } = action;
  const dist = Math.sqrt(
    (x - ctx.worldState.bot.position.x) ** 2 +
    (z - ctx.worldState.bot.position.z) ** 2
  );

  if (dist > MAX_WALK_DISTANCE) {
    return {
      success: false,
      message: `Too far to walk (${dist.toFixed(0)} blocks). Max is ${MAX_WALK_DISTANCE}.`,
      actionType: 'walkTo',
    };
  }

  walkAbortController = new AbortController();
  const result = await walkToPosition(ctx, x, y, z, walkAbortController.signal);
  walkAbortController = null;

  let message: string;
  if (result.arrived) {
    message = `Walked to (${x}, ${y}, ${z})`;
  } else if (result.stuck) {
    message = `Got stuck while walking to (${x}, ${y}, ${z}), blocked ${result.distance.toFixed(0)} blocks away. There may be an obstacle in the way.`;
  } else {
    message = `Walked toward (${x}, ${y}, ${z}), stopped ${result.distance.toFixed(0)} blocks away`;
  }

  return {
    success: result.arrived,
    message,
    actionType: 'walkTo',
  };
}

export async function executeSurvivalWalkToPlayer(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'walkToPlayer') {
    return { success: false, message: 'Invalid action type', actionType: 'walkToPlayer' };
  }

  const player = ctx.worldState.getPlayerByName(action.playerName);
  if (!player) {
    return {
      success: false,
      message: `Player "${action.playerName}" not found nearby.`,
      actionType: 'walkToPlayer',
    };
  }

  // Walk to 2 blocks in front of the player
  const yawRad = (player.yaw * Math.PI) / 180;
  const tx = player.position.x + (-Math.sin(yawRad) * 2);
  const tz = player.position.z + (Math.cos(yawRad) * 2);
  const ty = player.position.y;

  if (walkAbortController) {
    walkAbortController.abort();
    walkAbortController = null;
  }

  walkAbortController = new AbortController();
  const result = await walkToPosition(ctx, tx, ty, tz, walkAbortController.signal);
  walkAbortController = null;

  let message: string;
  if (result.arrived) {
    message = `Walked to ${action.playerName}`;
  } else if (result.stuck) {
    message = `Got stuck while walking to ${action.playerName}, blocked ${result.distance.toFixed(0)} blocks away. There may be an obstacle in the way.`;
  } else {
    message = `Walking toward ${action.playerName}, ${result.distance.toFixed(0)} blocks away`;
  }

  return {
    success: result.arrived,
    message,
    actionType: 'walkToPlayer',
  };
}

export function cancelWalk(): void {
  if (walkAbortController) {
    walkAbortController.abort();
    walkAbortController = null;
  }
}

// Active follow state for survival mode
let survivalFollowInterval: ReturnType<typeof setInterval> | null = null;
let survivalFollowTarget: string | null = null;

export async function executeSurvivalFollowPlayer(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'followPlayer') {
    return { success: false, message: 'Invalid action type', actionType: 'followPlayer' };
  }

  const player = ctx.worldState.getPlayerByName(action.playerName);
  if (!player) {
    return {
      success: false,
      message: `Player "${action.playerName}" not found nearby.`,
      actionType: 'followPlayer',
    };
  }

  stopSurvivalFollow();
  survivalFollowTarget = action.playerName;
  const duration = (action.duration ?? 60) * 1000;
  const startTime = Date.now();

  console.log(`[SurvivalFollow] Following ${action.playerName} for ${duration / 1000}s`);

  survivalFollowInterval = setInterval(() => {
    if (Date.now() - startTime > duration) {
      console.log(`[SurvivalFollow] Follow expired for ${survivalFollowTarget}`);
      stopSurvivalFollow();
      return;
    }

    const target = ctx.worldState.getPlayerByName(action.playerName);
    if (!target) {
      console.log(`[SurvivalFollow] Lost ${action.playerName}`);
      stopSurvivalFollow();
      return;
    }

    const dist = Math.sqrt(
      (target.position.x - ctx.worldState.bot.position.x) ** 2 +
      (target.position.z - ctx.worldState.bot.position.z) ** 2
    );

    // Only move if more than 3 blocks away
    if (dist > 3) {
      // Walk 3 blocks behind player
      const yawRad = (target.yaw * Math.PI) / 180;
      const tx = target.position.x + Math.sin(yawRad) * 3;
      const tz = target.position.z - Math.cos(yawRad) * 3;

      // Take a few steps toward target
      const dx = tx - ctx.worldState.bot.position.x;
      const dz = tz - ctx.worldState.bot.position.z;
      const m = Math.sqrt(dx * dx + dz * dz);
      const stepDist = Math.min(m, BLOCKS_PER_STEP * 10); // ~1 second of walking per tick
      const nx = ctx.worldState.bot.position.x + (dx / m) * stepDist;
      const nz = ctx.worldState.bot.position.z + (dz / m) * stepDist;
      const yaw = calcYaw(dx, dz);

      sendPosition(ctx, nx, target.position.y, nz, yaw, 0);
    }
  }, 500);

  return {
    success: true,
    message: `Now following ${action.playerName} for ${duration / 1000}s`,
    actionType: 'followPlayer',
  };
}

export async function executeSurvivalStopFollowing(): Promise<ActionResult> {
  if (!survivalFollowTarget) {
    return { success: true, message: 'Not currently following anyone.', actionType: 'stopFollowing' };
  }
  const target = survivalFollowTarget;
  stopSurvivalFollow();
  return { success: true, message: `Stopped following ${target}.`, actionType: 'stopFollowing' };
}

export function isSurvivalFollowing(): boolean {
  return survivalFollowInterval !== null;
}

export function getSurvivalFollowTarget(): string | null {
  return survivalFollowTarget;
}

function stopSurvivalFollow(): void {
  if (survivalFollowInterval) {
    clearInterval(survivalFollowInterval);
    survivalFollowInterval = null;
  }
  survivalFollowTarget = null;
}

// ─── Combat ────────────────────────────────────────────────────────────

function swingArm(ctx: SkillContext): void {
  const client = ctx.connection.getClient();
  if (!client) return;

  client.queue('animate' as any, {
    action_id: 'swing_arm',
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    data: 0.0,
    has_swing_source: false,
  });
}

function attackEntityPacket(ctx: SkillContext, entityRuntimeId: bigint): void {
  const client = ctx.connection.getClient();
  if (!client) return;

  const pos = ctx.worldState.bot.position;

  client.queue('inventory_transaction' as any, {
    transaction: {
      legacy: { legacy_request_id: 0, legacy_transactions: [] },
      transaction_type: 'item_use_on_entity',
      actions: [],
      transaction_data: {
        entity_runtime_id: entityRuntimeId,
        action_type: 'attack',
        hotbar_slot: 0,
        held_item: { network_id: 0, count: 0, metadata: 0, has_stack_id: 0, block_runtime_id: 0 },
        player_pos: { x: pos.x, y: pos.y, z: pos.z },
        click_pos: { x: 0, y: 0, z: 0 },
      },
    },
  });
}

export async function executeSurvivalAttack(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'attack') {
    return { success: false, message: 'Invalid action type', actionType: 'attack' };
  }

  // Health guard — refuse combat if health is dangerously low
  if (ctx.worldState.attributes.health < 6) {
    return {
      success: false,
      message: `Health too low to fight safely (${ctx.worldState.attributes.health.toFixed(0)}/20). Eat food or retreat first.`,
      actionType: 'attack',
    };
  }

  // Auto-equip best weapon from hotbar
  const weaponPriority = [
    'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
    'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe',
  ];
  for (const weapon of weaponPriority) {
    const found = ctx.worldState.findHotbarItem(weapon);
    if (found && found.slot !== ctx.worldState.heldSlot) {
      const client = ctx.connection.getClient();
      if (client) {
        const toolItem = found.item;
        client.queue('mob_equipment' as any, {
          runtime_entity_id: ctx.worldState.getBotRuntimeId(),
          item: { network_id: toolItem.networkId ?? 0, count: toolItem.count ?? 1, metadata: 0, has_stack_id: 0, block_runtime_id: 0 },
          slot: found.slot,
          selected_slot: found.slot,
          window_id: 'inventory',
        });
        ctx.worldState.heldSlot = found.slot;
        await sleep(100);
      }
      break;
    }
  }

  const entityName = action.entityName.toLowerCase();
  let nearest: { dist: number; rid: bigint; pos: { x: number; y: number; z: number }; name: string } | null = null;

  for (const entity of ctx.worldState.entities.values()) {
    const name = entity.displayName.toLowerCase();
    const type = entity.entityType.replace('minecraft:', '').toLowerCase();
    if (name.includes(entityName) || type.includes(entityName)) {
      const dist = Math.sqrt(
        (entity.position.x - ctx.worldState.bot.position.x) ** 2 +
        (entity.position.y - ctx.worldState.bot.position.y) ** 2 +
        (entity.position.z - ctx.worldState.bot.position.z) ** 2
      );
      if (!nearest || dist < nearest.dist) {
        nearest = { dist, rid: entity.runtimeId, pos: entity.position, name: entity.displayName };
      }
    }
  }

  if (!nearest) {
    return { success: false, message: `No "${action.entityName}" found nearby.`, actionType: 'attack' };
  }

  // Walk closer if needed (melee range ~3 blocks)
  if (nearest.dist > 4) {
    // Walk toward entity
    const dx = nearest.pos.x - ctx.worldState.bot.position.x;
    const dz = nearest.pos.z - ctx.worldState.bot.position.z;
    const m = Math.sqrt(dx * dx + dz * dz);
    const tx = nearest.pos.x - (dx / m) * 2; // stop 2 blocks short
    const tz = nearest.pos.z - (dz / m) * 2;

    const abort = new AbortController();
    await walkToPosition(ctx, tx, nearest.pos.y, tz, abort.signal);
  }

  // Face the entity
  const dx = nearest.pos.x - ctx.worldState.bot.position.x;
  const dz = nearest.pos.z - ctx.worldState.bot.position.z;
  const dy = nearest.pos.y - ctx.worldState.bot.position.y;
  const hdist = Math.sqrt(dx * dx + dz * dz);
  const yaw = calcYaw(dx, dz);
  const pitch = -Math.atan2(dy, hdist) * (180 / Math.PI);
  sendPosition(ctx, ctx.worldState.bot.position.x, ctx.worldState.bot.position.y, ctx.worldState.bot.position.z, yaw, pitch);

  // Swing + attack (3 hits with cooldown)
  const hits = 3;
  for (let i = 0; i < hits; i++) {
    swingArm(ctx);
    attackEntityPacket(ctx, nearest.rid);
    if (i < hits - 1) await sleep(500); // attack cooldown
  }

  return {
    success: true,
    message: `Attacked ${nearest.name} (${hits} hits)`,
    actionType: 'attack',
  };
}

// ─── Mining ────────────────────────────────────────────────────────────

export async function executeSurvivalMineBlock(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'breakBlock') {
    return { success: false, message: 'Invalid action type', actionType: 'breakBlock' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'breakBlock' };
  }

  const { x, y, z } = action;
  const rid = ctx.worldState.getBotRuntimeId();
  const blockName = (action as any).block ?? 'unknown';

  // Auto-select best tool for the block if we have one
  const hotbarTools: { name: string; slot: number }[] = [];
  for (let slot = 0; slot < 9; slot++) {
    const item = ctx.worldState.getHotbarItem(slot);
    if (item) hotbarTools.push({ name: item.name, slot });
  }

  const bestTool = ctx.worldState.dataLookup.getBestToolForBlock(blockName, hotbarTools);
  if (bestTool && bestTool.slot !== ctx.worldState.heldSlot) {
    // Equip the best tool
    const toolItem = ctx.worldState.getHotbarItem(bestTool.slot);
    const toolNetworkId = toolItem?.networkId ?? 0;
    client.queue('mob_equipment' as any, {
      runtime_entity_id: rid,
      item: { network_id: toolNetworkId, count: toolNetworkId ? (toolItem?.count ?? 1) : 0, metadata: 0, has_stack_id: 0, block_runtime_id: 0 },
      slot: bestTool.slot,
      selected_slot: bestTool.slot,
      window_id: 'inventory',
    });
    ctx.worldState.heldSlot = bestTool.slot;
    await sleep(100);
  }

  // Check if held tool (or best tool) meets minimum tier for drops
  const heldItem = ctx.worldState.getHeldItem();
  const toolToCheck = bestTool ? bestTool.name : heldItem?.name;
  const harvestCheck = ctx.worldState.dataLookup.canHarvest(blockName, toolToCheck);
  if (!harvestCheck.canHarvest) {
    return {
      success: false,
      message: `Cannot mine "${blockName}": ${harvestCheck.reason}`,
      actionType: 'breakBlock',
    };
  }

  // Warn if tool is about to break (but don't block)
  let durabilityWarning = '';
  const activeItem = bestTool
    ? ctx.worldState.getHotbarItem(bestTool.slot)
    : heldItem;
  if (activeItem && activeItem.damage !== undefined) {
    const durPct = ctx.worldState.dataLookup.getDurabilityPercent(activeItem.name, activeItem.damage);
    if (durPct !== null && durPct <= 10) {
      durabilityWarning = ` WARNING: ${activeItem.name} is at ${durPct}% durability — consider crafting a replacement soon.`;
    }
  }

  // Calculate mining time based on block type and held tool
  const miningTimeMs = ctx.worldState.dataLookup.getMiningTimeMs(
    blockName,
    heldItem?.name
  );

  if (miningTimeMs === -1) {
    return { success: false, message: `Block "${blockName}" is unbreakable`, actionType: 'breakBlock' };
  }

  // Face the block
  const dx = x + 0.5 - ctx.worldState.bot.position.x;
  const dz = z + 0.5 - ctx.worldState.bot.position.z;
  const dy = y + 0.5 - ctx.worldState.bot.position.y;
  const hdist = Math.sqrt(dx * dx + dz * dz);
  const yaw = calcYaw(dx, dz);
  const pitch = -Math.atan2(dy, hdist) * (180 / Math.PI);
  sendPosition(ctx, ctx.worldState.bot.position.x, ctx.worldState.bot.position.y, ctx.worldState.bot.position.z, yaw, pitch);
  await sleep(100);

  // Determine which face to mine from
  const face = determineFace(ctx.worldState.bot.position, { x, y, z });

  // Start breaking
  client.queue('player_action' as any, {
    runtime_entity_id: rid,
    action: 'start_break',
    position: { x, y, z },
    result_position: { x, y, z },
    face,
  });

  // Swing arm while breaking
  swingArm(ctx);

  // Cap mining time at 15 seconds
  const breakTime = Math.min(miningTimeMs, 15000);

  // Send crack_break packets during mining to show progress
  const crackInterval = setInterval(() => {
    swingArm(ctx);
    client.queue('player_action' as any, {
      runtime_entity_id: rid,
      action: 'crack_break',
      position: { x, y, z },
      result_position: { x, y, z },
      face,
    });
  }, 250);

  await sleep(breakTime);
  clearInterval(crackInterval);

  // Finish breaking
  client.queue('player_action' as any, {
    runtime_entity_id: rid,
    action: 'stop_break',
    position: { x, y, z },
    result_position: { x, y, z },
    face,
  });

  client.queue('player_action' as any, {
    runtime_entity_id: rid,
    action: 'predict_break',
    position: { x, y, z },
    result_position: { x, y, z },
    face,
  });

  // Wait for server confirmation via update_block packet
  const confirmed = await waitForBlockUpdate(client, x, y, z, 2000);

  const toolMsg = bestTool ? ` with ${bestTool.name}` : '';
  if (!confirmed) {
    return {
      success: false,
      message: `Server did not confirm block break at (${x}, ${y}, ${z})${toolMsg}. Block may be protected or too far.${durabilityWarning}`,
      actionType: 'breakBlock',
    };
  }

  return {
    success: true,
    message: `Broke block at (${x}, ${y}, ${z})${toolMsg} (${(breakTime / 1000).toFixed(1)}s)${durabilityWarning}`,
    actionType: 'breakBlock',
  };
}

// Determine which face of the block the bot is looking at
function determineFace(botPos: { x: number; y: number; z: number }, blockPos: { x: number; y: number; z: number }): number {
  const dx = botPos.x - (blockPos.x + 0.5);
  const dy = botPos.y - (blockPos.y + 0.5);
  const dz = botPos.z - (blockPos.z + 0.5);

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const absDz = Math.abs(dz);

  if (absDy >= absDx && absDy >= absDz) {
    return dy > 0 ? 1 : 0; // top (1) or bottom (0)
  }
  if (absDz >= absDx) {
    return dz > 0 ? 3 : 2; // south (3) or north (2)
  }
  return dx > 0 ? 5 : 4; // east (5) or west (4)
}

// ─── Block Placement ───────────────────────────────────────────────────

export async function executeSurvivalPlaceBlock(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'placeBlock') {
    return { success: false, message: 'Invalid action type', actionType: 'placeBlock' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'placeBlock' };
  }

  const { x, y, z } = action;
  const pos = ctx.worldState.bot.position;

  // Find the block we want to place from inventory
  // For survival mode, we need to have the block in our inventory
  let hotbarSlot = -1;
  const blockName = action.block.toLowerCase();
  for (const [slot, item] of ctx.worldState.inventory) {
    if (slot < 9 && item.name.toLowerCase().includes(blockName)) {
      hotbarSlot = slot;
      break;
    }
  }

  if (hotbarSlot === -1) {
    return {
      success: false,
      message: `No "${action.block}" found in hotbar. Need to have it in slots 0-8.`,
      actionType: 'placeBlock',
    };
  }

  // Face the target position
  const dx = x + 0.5 - pos.x;
  const dz = z + 0.5 - pos.z;
  const dy = y + 0.5 - pos.y;
  const hdist = Math.sqrt(dx * dx + dz * dz);
  const yaw = calcYaw(dx, dz);
  const pitch = -Math.atan2(dy, hdist) * (180 / Math.PI);
  sendPosition(ctx, pos.x, pos.y, pos.z, yaw, pitch);
  await sleep(100);

  // Place block via inventory_transaction (item_use / click_block)
  // We place on the block below the target position (face = top = 1)
  client.queue('inventory_transaction' as any, {
    transaction: {
      legacy: { legacy_request_id: 0, legacy_transactions: [] },
      transaction_type: 'item_use',
      actions: [],
      transaction_data: {
        action_type: 'click_block',
        trigger_type: 'player_input',
        block_position: { x, y: y - 1, z }, // click on block below
        face: 1, // top face
        hotbar_slot: hotbarSlot,
        held_item: { network_id: 0, count: 0, metadata: 0, has_stack_id: 0, block_runtime_id: 0 }, // server validates this anyway
        player_pos: { x: pos.x, y: pos.y, z: pos.z },
        click_pos: { x: 0.5, y: 1.0, z: 0.5 },
        block_runtime_id: 0,
        client_prediction: 'success',
      },
    },
  });

  // Also send player_action start_item_use_on
  client.queue('player_action' as any, {
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    action: 'start_item_use_on',
    position: { x, y: y - 1, z },
    result_position: { x, y, z },
    face: 1,
  });

  await sleep(200);

  // Stop item use
  client.queue('player_action' as any, {
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    action: 'stop_item_use_on',
    position: { x, y: y - 1, z },
    result_position: { x, y, z },
    face: 1,
  });

  return {
    success: true,
    message: `Placed ${action.block} at (${x}, ${y}, ${z})`,
    actionType: 'placeBlock',
  };
}

// ─── Jump ──────────────────────────────────────────────────────────────

export async function executeSurvivalJump(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'jump') {
    return { success: false, message: 'Invalid action type', actionType: 'jump' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'jump' };
  }

  // Send jump action
  client.queue('player_action' as any, {
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    action: 'jump',
    position: {
      x: Math.floor(ctx.worldState.bot.position.x),
      y: Math.floor(ctx.worldState.bot.position.y),
      z: Math.floor(ctx.worldState.bot.position.z),
    },
    result_position: {
      x: Math.floor(ctx.worldState.bot.position.x),
      y: Math.floor(ctx.worldState.bot.position.y),
      z: Math.floor(ctx.worldState.bot.position.z),
    },
    face: 0,
  });

  // Simulate jump arc: up 1.25 blocks over 0.4s, then fall
  const startY = ctx.worldState.bot.position.y;
  const jumpHeight = 1.25;
  const jumpDuration = 400; // ms
  const steps = 8;
  const stepTime = jumpDuration / steps;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Parabolic arc: y = startY + jumpHeight * (4t - 4t²)
    const yOffset = jumpHeight * (4 * t - 4 * t * t);
    const y = startY + yOffset;
    sendPosition(
      ctx,
      ctx.worldState.bot.position.x,
      y,
      ctx.worldState.bot.position.z,
      ctx.worldState.bot.yaw,
      ctx.worldState.bot.pitch
    );
    await sleep(stepTime);
  }

  // Land
  sendPosition(ctx, ctx.worldState.bot.position.x, startY, ctx.worldState.bot.position.z, ctx.worldState.bot.yaw, ctx.worldState.bot.pitch);

  return { success: true, message: 'Jumped', actionType: 'jump' };
}

// ─── Sneak ─────────────────────────────────────────────────────────────

let isSneaking = false;

export async function executeSurvivalSneak(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'sneak') {
    return { success: false, message: 'Invalid action type', actionType: 'sneak' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'sneak' };
  }

  const shouldSneak = action.enabled ?? !isSneaking;

  client.queue('player_action' as any, {
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    action: shouldSneak ? 'start_sneak' : 'stop_sneak',
    position: {
      x: Math.floor(ctx.worldState.bot.position.x),
      y: Math.floor(ctx.worldState.bot.position.y),
      z: Math.floor(ctx.worldState.bot.position.z),
    },
    result_position: {
      x: Math.floor(ctx.worldState.bot.position.x),
      y: Math.floor(ctx.worldState.bot.position.y),
      z: Math.floor(ctx.worldState.bot.position.z),
    },
    face: 0,
  });

  isSneaking = shouldSneak;
  return {
    success: true,
    message: shouldSneak ? 'Now sneaking' : 'Stopped sneaking',
    actionType: 'sneak',
  };
}

// ─── Sprint ────────────────────────────────────────────────────────────

export async function executeSurvivalSprint(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'sprint') {
    return { success: false, message: 'Invalid action type', actionType: 'sprint' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'sprint' };
  }

  const shouldSprint = action.enabled ?? true;

  client.queue('player_action' as any, {
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    action: shouldSprint ? 'start_sprint' : 'stop_sprint',
    position: {
      x: Math.floor(ctx.worldState.bot.position.x),
      y: Math.floor(ctx.worldState.bot.position.y),
      z: Math.floor(ctx.worldState.bot.position.z),
    },
    result_position: {
      x: Math.floor(ctx.worldState.bot.position.x),
      y: Math.floor(ctx.worldState.bot.position.y),
      z: Math.floor(ctx.worldState.bot.position.z),
    },
    face: 0,
  });

  return {
    success: true,
    message: shouldSprint ? 'Now sprinting' : 'Stopped sprinting',
    actionType: 'sprint',
  };
}

// ─── Drop Item ─────────────────────────────────────────────────────────

export async function executeSurvivalDropItem(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'dropItem') {
    return { success: false, message: 'Invalid action type', actionType: 'dropItem' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'dropItem' };
  }

  client.queue('player_action' as any, {
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    action: 'drop_item',
    position: {
      x: Math.floor(ctx.worldState.bot.position.x),
      y: Math.floor(ctx.worldState.bot.position.y),
      z: Math.floor(ctx.worldState.bot.position.z),
    },
    result_position: {
      x: Math.floor(ctx.worldState.bot.position.x),
      y: Math.floor(ctx.worldState.bot.position.y),
      z: Math.floor(ctx.worldState.bot.position.z),
    },
    face: 0,
  });

  return { success: true, message: 'Dropped held item', actionType: 'dropItem' };
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Wait for server to confirm a block was broken at (x,y,z) via update_block. */
function waitForBlockUpdate(client: any, x: number, y: number, z: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const handler = (packet: any) => {
      if (resolved) return;
      const pos = packet.position;
      if (pos && pos.x === x && pos.y === y && pos.z === z) {
        // block_runtime_id 0 = air (block was destroyed)
        const rid = packet.block_runtime_id ?? packet.runtime_id ?? -1;
        if (rid === 0) {
          resolved = true;
          client.removeListener('update_block', handler);
          resolve(true);
        }
      }
    };
    client.on('update_block', handler);
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.removeListener('update_block', handler);
        resolve(false);
      }
    }, timeoutMs);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
