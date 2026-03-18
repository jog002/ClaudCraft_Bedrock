import { BotConnection } from '../bot/connection';
import { WorldState } from '../bot/worldState';

// All available action types
export type Action =
  | { type: 'chat'; message: string }
  | { type: 'navigateTo'; x: number; y: number; z: number }
  | { type: 'navigateToPlayer'; playerName: string }
  | { type: 'followPlayer'; playerName: string; duration?: number }
  | { type: 'stopFollowing' }
  | { type: 'lookAtPlayer'; playerName: string }
  | { type: 'attack'; entityName: string }
  | { type: 'command'; command: string }
  | { type: 'wait'; seconds: number }
  | { type: 'giveItem'; item: string; count?: number; target?: string }
  | { type: 'placeBlock'; block: string; x: number; y: number; z: number }
  | { type: 'breakBlock'; x: number; y: number; z: number }
  | { type: 'fillBlocks'; block: string; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; mode?: string }
  | { type: 'summon'; entityType: string; x?: number; y?: number; z?: number }
  | { type: 'setTime'; time: string }
  | { type: 'weather'; weather: string; duration?: number }
  | { type: 'effect'; effect: string; target?: string; duration?: number; amplifier?: number }
  | { type: 'enchant'; enchantment: string; level?: number }
  | { type: 'clearInventory'; target?: string; item?: string }
  | { type: 'teleportEntity'; target: string; x: number; y: number; z: number }
  | { type: 'gamemode'; mode: string; target?: string }
  // Stage 5 — mining, building, crafting (both modes)
  | { type: 'equipItem'; item?: string; slot?: number }
  | { type: 'equipArmor'; item: string }
  | { type: 'collectDrops'; radius?: number }
  | { type: 'craft'; item: string; count?: number }
  | { type: 'openContainer'; x: number; y: number; z: number }
  | { type: 'closeContainer' }
  | { type: 'storeItem'; item: string; count?: number }
  | { type: 'retrieveItem'; item: string; count?: number }
  // Interaction actions
  | { type: 'eatFood'; item?: string }
  | { type: 'sleepInBed'; x: number; y: number; z: number }
  // Scanning actions
  | { type: 'scanNearby'; radius?: number }
  | { type: 'deepScan'; filter?: string }
  // Survival (packet-level) actions — no cheats required
  | { type: 'walkTo'; x: number; y: number; z: number }
  | { type: 'walkToPlayer'; playerName: string }
  | { type: 'jump' }
  | { type: 'sneak'; enabled?: boolean }
  | { type: 'sprint'; enabled?: boolean }
  | { type: 'dropItem' }
  // Stage 6 — memory actions (both modes)
  | { type: 'rememberLocation'; name: string; note?: string }
  | { type: 'goToLocation'; name: string }
  | { type: 'addMemory'; text: string; category?: string }
  | { type: 'recallMemories'; query: string }
  | { type: 'saveSkill'; name: string; description: string; steps: string }
  | { type: 'addPlayerNote'; playerName: string; note: string }
  | { type: 'think'; question: string };

// What the LLM returns
export interface ActionRequest {
  thought: string;
  actions: Action[];
  goal?: string;
  goalComplete?: boolean;
}

// Result of executing a single action
export interface ActionResult {
  success: boolean;
  message: string;
  actionType: string;
}

// Shared context passed to all skills
export interface SkillContext {
  connection: BotConnection;
  worldState: WorldState;
}

// Interface that all skills implement
export interface Skill {
  execute(action: Action, context: SkillContext): Promise<ActionResult>;
}

// Goal persistence
export interface Goal {
  description: string;
  startedAt: number;
}

// Common action properties shared across modes
const COMMON_ACTION_PROPS = {
  message: { type: 'string', description: 'For chat: the message to send (max 200 chars).' },
  x: { type: 'number', description: 'X coordinate.' },
  y: { type: 'number', description: 'Y coordinate.' },
  z: { type: 'number', description: 'Z coordinate.' },
  playerName: { type: 'string', description: 'Player gamertag.' },
  entityName: { type: 'string', description: 'For attack: entity type (e.g. "zombie", "sheep").' },
  duration: { type: 'number', description: 'Seconds for follow/wait.' },
  seconds: { type: 'number', description: 'For wait: seconds to wait.' },
  block: { type: 'string', description: 'Block type (e.g. "stone", "oak_planks").' },
  enabled: { type: 'boolean', description: 'For sneak/sprint: toggle on/off.' },
  item: { type: 'string', description: 'Item name (e.g. "diamond", "iron_pickaxe").' },
  slot: { type: 'number', description: 'For equipItem: hotbar slot number (0-8).' },
  radius: { type: 'number', description: 'For collectDrops/scanNearby: search radius in blocks (default 16).' },
  count: { type: 'number', description: 'Quantity (default 1).' },
  filter: { type: 'string', description: 'For deepScan: comma-separated block types to search for (e.g. "diamond_ore,chest").' },
  // Stage 6 — memory action props
  name: { type: 'string', description: 'For rememberLocation/goToLocation/saveSkill: location or skill name.' },
  note: { type: 'string', description: 'For rememberLocation/addPlayerNote: optional note or observation.' },
  text: { type: 'string', description: 'For addMemory: the memory text to save.' },
  category: { type: 'string', description: 'For addMemory: category (observation/lesson/event/relationship).' },
  query: { type: 'string', description: 'For recallMemories: search keyword.' },
  description: { type: 'string', description: 'For saveSkill: what the skill does.' },
  steps: { type: 'string', description: 'For saveSkill: step-by-step action sequence.' },
  question: { type: 'string', description: 'For think: a complex question to reason about using the planning model.' },
};

const CHEAT_ACTION_PROPS = {
  x1: { type: 'number', description: 'For fillBlocks: start X.' },
  y1: { type: 'number', description: 'For fillBlocks: start Y.' },
  z1: { type: 'number', description: 'For fillBlocks: start Z.' },
  x2: { type: 'number', description: 'For fillBlocks: end X.' },
  y2: { type: 'number', description: 'For fillBlocks: end Y.' },
  z2: { type: 'number', description: 'For fillBlocks: end Z.' },
  entityType: { type: 'string', description: 'For summon: entity type (e.g. "cow", "zombie").' },
  command: { type: 'string', description: 'For command: the slash command.' },
  target: { type: 'string', description: 'Target selector or player name (default @s).' },
  mode: { type: 'string', description: 'Fill mode or gamemode.' },
  time: { type: 'string', description: 'For setTime: time value.' },
  weather: { type: 'string', description: 'For weather: clear/rain/thunder.' },
  effect: { type: 'string', description: 'Effect name (e.g. "speed", "strength").' },
  amplifier: { type: 'number', description: 'Effect amplifier level (0-255).' },
  enchantment: { type: 'string', description: 'Enchantment name.' },
  level: { type: 'number', description: 'Enchantment level.' },
};

const CHEAT_ACTION_TYPES = [
  'chat', 'navigateTo', 'navigateToPlayer', 'followPlayer', 'stopFollowing',
  'lookAtPlayer', 'attack', 'command', 'wait',
  'giveItem', 'placeBlock', 'breakBlock', 'fillBlocks', 'summon',
  'setTime', 'weather', 'effect', 'enchant', 'clearInventory',
  'teleportEntity', 'gamemode',
  // Stage 5
  'equipItem', 'equipArmor', 'collectDrops', 'craft',
  'openContainer', 'closeContainer', 'storeItem', 'retrieveItem',
  'eatFood', 'sleepInBed',
  'scanNearby', 'deepScan',
  // Stage 6 — memory
  'rememberLocation', 'goToLocation', 'addMemory', 'recallMemories',
  'saveSkill', 'addPlayerNote', 'think',
];

const SURVIVAL_ACTION_TYPES = [
  'chat', 'walkTo', 'walkToPlayer', 'followPlayer', 'stopFollowing',
  'lookAtPlayer', 'attack', 'wait',
  'placeBlock', 'breakBlock',
  'jump', 'sneak', 'sprint', 'dropItem',
  // Stage 5
  'equipItem', 'equipArmor', 'collectDrops', 'craft',
  'openContainer', 'closeContainer', 'storeItem', 'retrieveItem',
  'eatFood', 'sleepInBed',
  'scanNearby', 'deepScan',
  // Stage 6 — memory
  'rememberLocation', 'goToLocation', 'addMemory', 'recallMemories',
  'saveSkill', 'addPlayerNote', 'think',
];

// Build tool definition dynamically based on cheats mode
export function getActionToolDefinition(cheats: boolean) {
  const actionTypes = cheats ? CHEAT_ACTION_TYPES : SURVIVAL_ACTION_TYPES;
  const actionProps = cheats
    ? { ...COMMON_ACTION_PROPS, ...CHEAT_ACTION_PROPS }
    : COMMON_ACTION_PROPS;

  return {
    name: 'take_actions' as const,
    description: 'Execute one or more in-game Minecraft actions. You MUST call this tool to do anything.',
    input_schema: {
      type: 'object' as const,
      properties: {
        thought: {
          type: 'string',
          description: 'Your internal reasoning about what to do and why. This is NOT shown in-game.',
        },
        actions: {
          type: 'array',
          description: 'Actions to execute in order.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: actionTypes,
                description: 'The action type to execute.',
              },
              ...actionProps,
            },
            required: ['type'],
          },
        },
        goal: {
          type: 'string',
          description: 'Optional: set or update your current long-term goal.',
        },
        goalComplete: {
          type: 'boolean',
          description: 'Optional: set to true when current goal is finished.',
        },
      },
      required: ['thought', 'actions'],
    },
  };
}

// Keep backward-compatible export (defaults to cheats mode)
export const ACTION_TOOL_DEFINITION = getActionToolDefinition(true);
