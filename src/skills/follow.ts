import { Action, ActionResult, SkillContext } from './types';

// Active follow state — only one follow can be active at a time
let followInterval: ReturnType<typeof setInterval> | null = null;
let followTarget: string | null = null;

export async function executeFollowPlayer(action: Action, ctx: SkillContext): Promise<ActionResult> {
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

  // Stop any existing follow
  stopFollow();

  followTarget = action.playerName;
  const duration = (action.duration ?? 60) * 1000;
  const startTime = Date.now();

  console.log(`[Follow] Following ${action.playerName} for ${duration / 1000}s`);

  followInterval = setInterval(() => {
    // Check timeout
    if (Date.now() - startTime > duration) {
      console.log(`[Follow] Follow duration expired for ${followTarget}`);
      stopFollow();
      return;
    }

    const target = ctx.worldState.getPlayerByName(action.playerName);
    if (!target) {
      console.log(`[Follow] Lost track of ${action.playerName}, stopping`);
      stopFollow();
      return;
    }

    // Only teleport if player is more than 5 blocks away (prevents jitter)
    const dist = Math.sqrt(
      (target.position.x - ctx.worldState.bot.position.x) ** 2 +
      (target.position.z - ctx.worldState.bot.position.z) ** 2
    );
    if (dist < 5) return;

    // Teleport 3 blocks behind the player
    const yawRad = (target.yaw * Math.PI) / 180;
    const offsetX = Math.sin(yawRad) * 3;
    const offsetZ = -Math.cos(yawRad) * 3;
    const x = (target.position.x + offsetX).toFixed(1);
    const y = target.position.y.toFixed(1);
    const z = (target.position.z + offsetZ).toFixed(1);

    ctx.connection.sendCommand(`tp @s ${x} ${y} ${z}`);
  }, 1500);

  return {
    success: true,
    message: `Now following ${action.playerName} for ${duration / 1000}s`,
    actionType: 'followPlayer',
  };
}

export async function executeStopFollowing(): Promise<ActionResult> {
  if (!followTarget) {
    return { success: true, message: 'Not currently following anyone.', actionType: 'stopFollowing' };
  }
  const target = followTarget;
  stopFollow();
  return { success: true, message: `Stopped following ${target}.`, actionType: 'stopFollowing' };
}

export function isFollowing(): boolean {
  return followInterval !== null;
}

export function getFollowTarget(): string | null {
  return followTarget;
}

function stopFollow(): void {
  if (followInterval) {
    clearInterval(followInterval);
    followInterval = null;
  }
  followTarget = null;
}
