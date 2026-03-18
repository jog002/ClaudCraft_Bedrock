import { Action, ActionResult, SkillContext } from './types';

export async function executeNavigateTo(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'navigateTo') {
    return { success: false, message: 'Invalid action type', actionType: 'navigateTo' };
  }

  const { x, y, z } = action;
  ctx.connection.sendCommand(`tp @s ${x} ${y} ${z}`);

  // Wait briefly for the tp to take effect and position to update
  await sleep(500);

  const pos = ctx.worldState.bot.position;
  const dist = Math.sqrt(
    (pos.x - x) ** 2 + (pos.y - y) ** 2 + (pos.z - z) ** 2
  );

  if (dist < 5) {
    return { success: true, message: `Teleported to (${x}, ${y}, ${z})`, actionType: 'navigateTo' };
  }
  return { success: true, message: `Sent tp to (${x}, ${y}, ${z}), current distance: ${dist.toFixed(0)}`, actionType: 'navigateTo' };
}

export async function executeNavigateToPlayer(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'navigateToPlayer') {
    return { success: false, message: 'Invalid action type', actionType: 'navigateToPlayer' };
  }

  const player = ctx.worldState.getPlayerByName(action.playerName);
  if (!player) {
    return {
      success: false,
      message: `Player "${action.playerName}" not found nearby.`,
      actionType: 'navigateToPlayer',
    };
  }

  // Teleport 2 blocks in front of the player (based on their yaw)
  const yawRad = (player.yaw * Math.PI) / 180;
  const offsetX = -Math.sin(yawRad) * 2;
  const offsetZ = Math.cos(yawRad) * 2;
  const x = Math.round(player.position.x + offsetX);
  const y = Math.round(player.position.y);
  const z = Math.round(player.position.z + offsetZ);

  ctx.connection.sendCommand(`tp @s ${x} ${y} ${z}`);
  await sleep(500);

  return {
    success: true,
    message: `Teleported near ${action.playerName} at (${x}, ${y}, ${z})`,
    actionType: 'navigateToPlayer',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
