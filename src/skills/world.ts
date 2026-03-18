import { Action, ActionResult, SkillContext } from './types';

export async function executeGiveItem(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'giveItem') {
    return { success: false, message: 'Invalid action type', actionType: 'giveItem' };
  }
  const item = action.item;
  const count = action.count ?? 1;
  const target = action.target ?? '@s';
  ctx.connection.sendCommand(`give ${target} ${item} ${count}`);
  await sleep(300);
  return { success: true, message: `Gave ${count}x ${item} to ${target}`, actionType: 'giveItem' };
}

export async function executePlaceBlock(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'placeBlock') {
    return { success: false, message: 'Invalid action type', actionType: 'placeBlock' };
  }
  const { block, x, y, z } = action;
  ctx.connection.sendCommand(`setblock ${x} ${y} ${z} ${block}`);
  await sleep(300);
  return { success: true, message: `Placed ${block} at (${x}, ${y}, ${z})`, actionType: 'placeBlock' };
}

export async function executeBreakBlock(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'breakBlock') {
    return { success: false, message: 'Invalid action type', actionType: 'breakBlock' };
  }
  const { x, y, z } = action;
  ctx.connection.sendCommand(`setblock ${x} ${y} ${z} air destroy`);
  await sleep(300);
  return { success: true, message: `Broke block at (${x}, ${y}, ${z})`, actionType: 'breakBlock' };
}

export async function executeFillBlocks(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'fillBlocks') {
    return { success: false, message: 'Invalid action type', actionType: 'fillBlocks' };
  }
  const { block, x1, y1, z1, x2, y2, z2 } = action;
  const mode = action.mode ?? 'replace';
  ctx.connection.sendCommand(`fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block} 0 ${mode}`);
  await sleep(500);
  return { success: true, message: `Filled area (${x1},${y1},${z1}) to (${x2},${y2},${z2}) with ${block} [${mode}]`, actionType: 'fillBlocks' };
}

export async function executeSummon(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'summon') {
    return { success: false, message: 'Invalid action type', actionType: 'summon' };
  }
  const { entityType } = action;
  const pos = ctx.worldState.bot.position;
  const x = action.x ?? Math.round(pos.x + 2);
  const y = action.y ?? Math.round(pos.y);
  const z = action.z ?? Math.round(pos.z + 2);
  ctx.connection.sendCommand(`summon ${entityType} ${x} ${y} ${z}`);
  await sleep(300);
  return { success: true, message: `Summoned ${entityType} at (${x}, ${y}, ${z})`, actionType: 'summon' };
}

export async function executeSetTime(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'setTime') {
    return { success: false, message: 'Invalid action type', actionType: 'setTime' };
  }
  ctx.connection.sendCommand(`time set ${action.time}`);
  await sleep(300);
  return { success: true, message: `Set time to ${action.time}`, actionType: 'setTime' };
}

export async function executeWeather(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'weather') {
    return { success: false, message: 'Invalid action type', actionType: 'weather' };
  }
  const dur = action.duration ? ` ${action.duration}` : '';
  ctx.connection.sendCommand(`weather ${action.weather}${dur}`);
  await sleep(300);
  return { success: true, message: `Set weather to ${action.weather}`, actionType: 'weather' };
}

export async function executeEffect(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'effect') {
    return { success: false, message: 'Invalid action type', actionType: 'effect' };
  }
  const target = action.target ?? '@s';
  const duration = action.duration ?? 30;
  const amplifier = action.amplifier ?? 0;
  ctx.connection.sendCommand(`effect ${target} ${action.effect} ${duration} ${amplifier}`);
  await sleep(300);
  return { success: true, message: `Applied ${action.effect} (level ${amplifier + 1}) to ${target} for ${duration}s`, actionType: 'effect' };
}

export async function executeEnchant(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'enchant') {
    return { success: false, message: 'Invalid action type', actionType: 'enchant' };
  }
  const level = action.level ?? 1;
  ctx.connection.sendCommand(`enchant @s ${action.enchantment} ${level}`);
  await sleep(300);
  return { success: true, message: `Enchanted held item with ${action.enchantment} ${level}`, actionType: 'enchant' };
}

export async function executeClearInventory(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'clearInventory') {
    return { success: false, message: 'Invalid action type', actionType: 'clearInventory' };
  }
  const target = action.target ?? '@s';
  const item = action.item ? ` ${action.item}` : '';
  ctx.connection.sendCommand(`clear ${target}${item}`);
  await sleep(300);
  return { success: true, message: `Cleared${item ? ` ${action.item} from` : ''} inventory of ${target}`, actionType: 'clearInventory' };
}

export async function executeTeleportEntity(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'teleportEntity') {
    return { success: false, message: 'Invalid action type', actionType: 'teleportEntity' };
  }
  const { target, x, y, z } = action;
  ctx.connection.sendCommand(`tp ${target} ${x} ${y} ${z}`);
  await sleep(300);
  return { success: true, message: `Teleported ${target} to (${x}, ${y}, ${z})`, actionType: 'teleportEntity' };
}

export async function executeGamemode(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'gamemode') {
    return { success: false, message: 'Invalid action type', actionType: 'gamemode' };
  }
  const target = action.target ?? '@s';
  ctx.connection.sendCommand(`gamemode ${action.mode} ${target}`);
  await sleep(300);
  return { success: true, message: `Set gamemode to ${action.mode} for ${target}`, actionType: 'gamemode' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
