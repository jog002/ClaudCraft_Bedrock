import { Action, ActionResult, SkillContext } from './types';

export async function executeLookAtPlayer(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'lookAtPlayer') {
    return { success: false, message: 'Invalid action type', actionType: 'lookAtPlayer' };
  }

  const player = ctx.worldState.getPlayerByName(action.playerName);
  if (!player) {
    return {
      success: false,
      message: `Player "${action.playerName}" not found nearby.`,
      actionType: 'lookAtPlayer',
    };
  }

  lookAt(ctx, player.position.x, player.position.y, player.position.z);
  return {
    success: true,
    message: `Now looking at ${action.playerName}`,
    actionType: 'lookAtPlayer',
  };
}

function lookAt(ctx: SkillContext, tx: number, ty: number, tz: number): void {
  const client = ctx.connection.getClient();
  if (!client) return;

  const bot = ctx.worldState.bot;
  const dx = tx - bot.position.x;
  const dy = ty - bot.position.y;
  const dz = tz - bot.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  const yaw = -Math.atan2(dx, dz) * (180 / Math.PI);
  const pitch = -Math.atan2(dy, dist) * (180 / Math.PI);

  client.queue('move_player' as any, {
    runtime_id: Number(ctx.worldState.getBotRuntimeId()),
    position: {
      x: bot.position.x,
      y: bot.position.y,
      z: bot.position.z,
    },
    pitch,
    yaw,
    head_yaw: yaw,
    mode: 'normal',
    on_ground: true,
    ridden_runtime_id: 0,
    tick: 0,
  });
}
