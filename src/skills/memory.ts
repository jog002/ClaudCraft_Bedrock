/**
 * Memory-related skills — save locations, memories, skills, and player notes.
 */
import { Action, ActionResult, SkillContext } from './types';
import { MemoryManager } from '../memory/memoryManager';
import { LLMClient } from '../llm/client';

// ─── rememberLocation ───────────────────────────────────────────────────

export async function executeRememberLocation(
  action: Action, ctx: SkillContext, memory: MemoryManager
): Promise<ActionResult> {
  if (action.type !== 'rememberLocation') {
    return { success: false, message: 'Invalid action type', actionType: 'rememberLocation' };
  }

  const name = (action as any).name;
  if (!name) {
    return { success: false, message: 'Location name is required', actionType: 'rememberLocation' };
  }

  const pos = ctx.worldState.bot.position;
  const note = (action as any).note;
  memory.saveLocation(name, pos, note);

  return {
    success: true,
    message: `Saved location "${name}" at (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})${note ? `: ${note}` : ''}`,
    actionType: 'rememberLocation',
  };
}

// ─── goToLocation ───────────────────────────────────────────────────────

export async function executeGoToLocation(
  action: Action, ctx: SkillContext, memory: MemoryManager, cheats: boolean
): Promise<ActionResult> {
  if (action.type !== 'goToLocation') {
    return { success: false, message: 'Invalid action type', actionType: 'goToLocation' };
  }

  const name = (action as any).name;
  if (!name) {
    return { success: false, message: 'Location name is required', actionType: 'goToLocation' };
  }

  const loc = memory.getLocation(name);
  if (!loc) {
    const known = Object.keys(memory.getAllLocations());
    const knownStr = known.length > 0 ? ` Known locations: ${known.join(', ')}` : ' No locations saved yet.';
    return {
      success: false,
      message: `Unknown location "${name}".${knownStr}`,
      actionType: 'goToLocation',
    };
  }

  if (cheats) {
    // Teleport directly
    ctx.connection.sendCommand(`tp @s ${loc.x} ${loc.y} ${loc.z}`);
    ctx.worldState.bot.position = { x: loc.x, y: loc.y, z: loc.z };
    return {
      success: true,
      message: `Teleported to "${name}" at (${loc.x}, ${loc.y}, ${loc.z})`,
      actionType: 'goToLocation',
    };
  }

  // Survival: check distance and inform the LLM
  const dist = Math.sqrt(
    (loc.x - ctx.worldState.bot.position.x) ** 2 +
    (loc.z - ctx.worldState.bot.position.z) ** 2
  );

  if (dist > 100) {
    return {
      success: false,
      message: `"${name}" is ${dist.toFixed(0)} blocks away — too far for a single walk. Use walkTo to walk partway (max 100 blocks at a time).`,
      actionType: 'goToLocation',
    };
  }

  // For short distances, report the coordinates so the LLM can use walkTo
  return {
    success: true,
    message: `"${name}" is at (${loc.x}, ${loc.y}, ${loc.z}), ${dist.toFixed(0)} blocks away. Use walkTo to go there.`,
    actionType: 'goToLocation',
  };
}

// ─── addMemory ──────────────────────────────────────────────────────────

export async function executeAddMemory(
  action: Action, memory: MemoryManager
): Promise<ActionResult> {
  if (action.type !== 'addMemory') {
    return { success: false, message: 'Invalid action type', actionType: 'addMemory' };
  }

  const text = (action as any).text;
  if (!text) {
    return { success: false, message: 'Memory text is required', actionType: 'addMemory' };
  }

  const category = (action as any).category ?? 'observation';
  const validCategories = ['observation', 'lesson', 'event', 'relationship'];
  const cat = validCategories.includes(category) ? category : 'observation';

  memory.addMemory(text, cat);

  return {
    success: true,
    message: `Remembered: "${text}" [${cat}]`,
    actionType: 'addMemory',
  };
}

// ─── recallMemories ─────────────────────────────────────────────────────

export async function executeRecallMemories(
  action: Action, memory: MemoryManager
): Promise<ActionResult> {
  if (action.type !== 'recallMemories') {
    return { success: false, message: 'Invalid action type', actionType: 'recallMemories' };
  }

  const query = (action as any).query;
  if (!query) {
    return { success: false, message: 'Search query is required', actionType: 'recallMemories' };
  }

  const results = memory.getRelevantMemories(query, 10);

  if (results.length === 0) {
    return {
      success: true,
      message: `No memories found matching "${query}".`,
      actionType: 'recallMemories',
    };
  }

  const lines = results.map(m => `- [${m.category}] ${m.text}`);

  // Also check saved skills
  const skill = memory.getSkill(query);
  if (skill) {
    lines.push(`\nSaved skill "${query}": ${skill.description}\nSteps: ${skill.steps}`);
  }

  return {
    success: true,
    message: `Memories matching "${query}":\n${lines.join('\n')}`,
    actionType: 'recallMemories',
  };
}

// ─── saveSkill ──────────────────────────────────────────────────────────

export async function executeSaveSkill(
  action: Action, memory: MemoryManager
): Promise<ActionResult> {
  if (action.type !== 'saveSkill') {
    return { success: false, message: 'Invalid action type', actionType: 'saveSkill' };
  }

  const name = (action as any).name;
  const description = (action as any).description;
  const steps = (action as any).steps;

  if (!name || !description || !steps) {
    return { success: false, message: 'Skill requires name, description, and steps', actionType: 'saveSkill' };
  }

  memory.saveSkill(name, description, steps);

  return {
    success: true,
    message: `Saved skill "${name}": ${description}`,
    actionType: 'saveSkill',
  };
}

// ─── addPlayerNote ──────────────────────────────────────────────────────

export async function executeAddPlayerNote(
  action: Action, memory: MemoryManager
): Promise<ActionResult> {
  if (action.type !== 'addPlayerNote') {
    return { success: false, message: 'Invalid action type', actionType: 'addPlayerNote' };
  }

  const playerName = (action as any).playerName;
  const note = (action as any).note;

  if (!playerName || !note) {
    return { success: false, message: 'Player name and note are required', actionType: 'addPlayerNote' };
  }

  memory.addPlayerNote(playerName, note);

  return {
    success: true,
    message: `Noted about ${playerName}: "${note}"`,
    actionType: 'addPlayerNote',
  };
}

// ─── think ─────────────────────────────────────────────────────────────

export async function executeThink(
  action: Action, ctx: SkillContext, memory: MemoryManager, llmClient: LLMClient
): Promise<ActionResult> {
  if (action.type !== 'think') {
    return { success: false, message: 'Invalid action type', actionType: 'think' };
  }

  const question = (action as any).question;
  if (!question) {
    return { success: false, message: 'Question is required', actionType: 'think' };
  }

  // Build context for the reasoning model
  const pos = ctx.worldState.bot.position;
  const systemPrompt = `You are a Minecraft strategy advisor. The bot is at (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}). Provide a concise, actionable plan.`;

  const result = await llmClient.reason(systemPrompt, question);

  if ('error' in result) {
    return {
      success: false,
      message: result.error,
      actionType: 'think',
    };
  }

  // Save the reasoning result as a memory so it persists
  memory.addMemory(`Planning insight: ${result.text.substring(0, 200)}`, 'lesson');

  return {
    success: true,
    message: `Reasoning result: ${result.text}`,
    actionType: 'think',
  };
}
