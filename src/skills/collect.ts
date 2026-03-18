/**
 * Item collection skill — walk to and pick up nearby dropped items.
 * Cheat mode: teleport items to bot or tp bot to items.
 * Survival mode: walk to nearest item entities.
 */
import { Action, ActionResult, SkillContext } from './types';

// ─── Cheat Mode ─────────────────────────────────────────────────────────

export async function executeCheatCollectDrops(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'collectDrops') {
    return { success: false, message: 'Invalid action type', actionType: 'collectDrops' };
  }

  const radius = action.radius ?? 16;

  // Use /tp to teleport all nearby items to the bot
  ctx.connection.sendCommand(`tp @e[type=item,r=${radius}] @s`);
  await sleep(500);

  const nearbyItems = ctx.worldState.getNearbyItemEntities(radius);
  const count = nearbyItems.length;

  return {
    success: true,
    message: count > 0
      ? `Collected ${count} nearby item(s)`
      : 'No dropped items nearby to collect',
    actionType: 'collectDrops',
  };
}

// ─── Survival Mode ──────────────────────────────────────────────────────

export async function executeSurvivalCollectDrops(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'collectDrops') {
    return { success: false, message: 'Invalid action type', actionType: 'collectDrops' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'collectDrops' };
  }

  const radius = action.radius ?? 16;
  const nearbyItems = ctx.worldState.getNearbyItemEntities(radius);

  if (nearbyItems.length === 0) {
    return { success: true, message: 'No dropped items nearby to collect', actionType: 'collectDrops' };
  }

  let collected = 0;
  const maxCollect = 5; // Limit to avoid long walks

  for (const item of nearbyItems.slice(0, maxCollect)) {
    const dist = distance(ctx.worldState.bot.position, item.position);
    if (dist > 100) continue; // Too far to walk

    // Walk toward the item (items are picked up automatically when within ~2 blocks)
    const steps = Math.ceil(dist / 0.2); // ~0.2 blocks per step at 50ms intervals
    const maxSteps = Math.min(steps, 200); // Cap at ~10 seconds of walking

    const dx = item.position.x - ctx.worldState.bot.position.x;
    const dz = item.position.z - ctx.worldState.bot.position.z;
    const mag = Math.sqrt(dx * dx + dz * dz);
    if (mag < 1.5) {
      collected++;
      continue; // Already close enough to pick up
    }

    const ux = dx / mag;
    const uz = dz / mag;
    const yaw = -Math.atan2(dx, dz) * (180 / Math.PI);
    const speed = 4.317 * (50 / 1000); // blocks per step

    let cx = ctx.worldState.bot.position.x;
    let cz = ctx.worldState.bot.position.z;
    const cy = item.position.y;

    for (let i = 0; i < maxSteps; i++) {
      cx += ux * speed;
      cz += uz * speed;

      const remaining = Math.sqrt(
        (item.position.x - cx) ** 2 + (item.position.z - cz) ** 2
      );

      ctx.worldState.bot.position = { x: cx, y: cy, z: cz };
      client.queue('move_player' as any, {
        runtime_id: Number(ctx.worldState.getBotRuntimeId()),
        position: { x: cx, y: cy, z: cz },
        pitch: 0,
        yaw,
        head_yaw: yaw,
        mode: 'normal',
        on_ground: true,
        ridden_runtime_id: 0,
        tick: 0,
      });

      if (remaining < 1.5) break;
      await sleep(50);
    }

    collected++;
    await sleep(200); // Brief pause between items
  }

  const remaining = nearbyItems.length - collected;
  return {
    success: true,
    message: `Walked to ${collected} item(s)${remaining > 0 ? `, ${remaining} more nearby` : ''}`,
    actionType: 'collectDrops',
  };
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
