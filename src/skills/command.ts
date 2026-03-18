import { Action, ActionResult, SkillContext } from './types';

export async function executeCommand(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'command') {
    return { success: false, message: 'Invalid action type', actionType: 'command' };
  }

  const cmd = action.command;
  console.log(`[Skill] Running command: ${cmd}`);
  ctx.connection.sendCommand(cmd);

  // Wait briefly for command to process
  await new Promise((r) => setTimeout(r, 300));

  return { success: true, message: `Executed command: ${cmd}`, actionType: 'command' };
}

export async function executeAttack(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'attack') {
    return { success: false, message: 'Invalid action type', actionType: 'attack' };
  }

  // Find nearest entity of the given type
  const entityName = action.entityName.toLowerCase();
  let nearest: { dist: number; pos: { x: number; y: number; z: number } } | null = null;

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
        nearest = { dist, pos: entity.position };
      }
    }
  }

  if (!nearest) {
    return { success: false, message: `No "${action.entityName}" found nearby.`, actionType: 'attack' };
  }

  // Teleport close and use /kill on nearest entity of that type
  // Note: /kill with selector is more reliable than melee
  ctx.connection.sendCommand(`tp @s ${nearest.pos.x.toFixed(1)} ${nearest.pos.y.toFixed(1)} ${nearest.pos.z.toFixed(1)}`);
  await new Promise((r) => setTimeout(r, 300));
  ctx.connection.sendCommand(`kill @e[type=${entityName},r=5,c=1]`);

  return { success: true, message: `Attacked nearest ${action.entityName}`, actionType: 'attack' };
}
