import mcdata from 'minecraft-data';

interface EntityInfo {
  name: string;
  displayName: string;
  category: 'hostile' | 'passive' | 'neutral' | 'other';
}

interface ItemInfo {
  name: string;
  displayName: string;
}

interface BlockInfo {
  name: string;
  displayName: string;
  hardness?: number;
}

// Tool tier multipliers for mining speed
export type ToolTier = 'wooden' | 'stone' | 'iron' | 'golden' | 'diamond' | 'netherite';
export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';

interface ToolInfo {
  tier: ToolTier;
  type: ToolType;
  speedMultiplier: number;
}

// Block hardness values (seconds to mine with bare hand)
// Source: Minecraft wiki. 0 = instant break, -1 = unbreakable
const BLOCK_HARDNESS: Record<string, number> = {
  // Instant break
  grass: 0, tall_grass: 0, flower: 0, torch: 0, redstone_torch: 0, snow_layer: 0,
  wheat: 0, carrots: 0, potatoes: 0, beetroot: 0, melon_stem: 0, pumpkin_stem: 0,
  dead_bush: 0, sugar_cane: 0, mushroom: 0, vine: 0, lily_pad: 0, fire: 0,
  // Soft
  dirt: 0.5, sand: 0.5, gravel: 0.6, clay: 0.6, soul_sand: 0.5,
  farmland: 0.6, grass_block: 0.6, mycelium: 0.6, podzol: 0.6,
  // Medium-soft
  wood: 2, planks: 2, log: 2, oak_log: 2, birch_log: 2, spruce_log: 2,
  jungle_log: 2, acacia_log: 2, dark_oak_log: 2, cherry_log: 2, mangrove_log: 2,
  oak_planks: 2, birch_planks: 2, spruce_planks: 2, jungle_planks: 2,
  crafting_table: 2.5, chest: 2.5, trapped_chest: 2.5, barrel: 2.5,
  bookshelf: 1.5, fence: 2, fence_gate: 2, wooden_door: 3, wooden_slab: 2,
  // Stone
  stone: 1.5, cobblestone: 2, sandstone: 0.8, netherrack: 0.4,
  brick: 2, stone_bricks: 1.5, mossy_stone_bricks: 1.5,
  deepslate: 3, tuff: 1.5, calcite: 0.75, dripstone_block: 1.5,
  // Ores
  coal_ore: 3, iron_ore: 3, gold_ore: 3, diamond_ore: 3, emerald_ore: 3,
  lapis_ore: 3, redstone_ore: 3, copper_ore: 3,
  deepslate_coal_ore: 4.5, deepslate_iron_ore: 4.5, deepslate_gold_ore: 4.5,
  deepslate_diamond_ore: 4.5, deepslate_emerald_ore: 4.5,
  // Hard
  iron_block: 5, gold_block: 3, diamond_block: 5, emerald_block: 5,
  obsidian: 50, crying_obsidian: 50, ancient_debris: 30,
  // Unbreakable
  bedrock: -1, barrier: -1, command_block: -1,
};

// Tool speed multipliers by tier
const TOOL_SPEED: Record<ToolTier, number> = {
  wooden: 2,
  stone: 4,
  iron: 6,
  golden: 12,
  diamond: 8,
  netherite: 9,
};

// Which tool types are effective for which block categories
const TOOL_EFFECTIVENESS: Record<string, ToolType> = {
  // Pickaxe blocks
  stone: 'pickaxe', cobblestone: 'pickaxe', sandstone: 'pickaxe', netherrack: 'pickaxe',
  brick: 'pickaxe', stone_bricks: 'pickaxe', mossy_stone_bricks: 'pickaxe',
  deepslate: 'pickaxe', tuff: 'pickaxe', calcite: 'pickaxe', dripstone_block: 'pickaxe',
  coal_ore: 'pickaxe', iron_ore: 'pickaxe', gold_ore: 'pickaxe', diamond_ore: 'pickaxe',
  emerald_ore: 'pickaxe', lapis_ore: 'pickaxe', redstone_ore: 'pickaxe', copper_ore: 'pickaxe',
  deepslate_coal_ore: 'pickaxe', deepslate_iron_ore: 'pickaxe', deepslate_gold_ore: 'pickaxe',
  deepslate_diamond_ore: 'pickaxe', deepslate_emerald_ore: 'pickaxe',
  iron_block: 'pickaxe', gold_block: 'pickaxe', diamond_block: 'pickaxe',
  emerald_block: 'pickaxe', obsidian: 'pickaxe', ancient_debris: 'pickaxe',
  furnace: 'pickaxe', anvil: 'pickaxe',
  // Axe blocks
  oak_log: 'axe', birch_log: 'axe', spruce_log: 'axe', jungle_log: 'axe',
  acacia_log: 'axe', dark_oak_log: 'axe', cherry_log: 'axe', mangrove_log: 'axe',
  oak_planks: 'axe', birch_planks: 'axe', spruce_planks: 'axe', jungle_planks: 'axe',
  crafting_table: 'axe', chest: 'axe', trapped_chest: 'axe', barrel: 'axe',
  bookshelf: 'axe', fence: 'axe', fence_gate: 'axe', wooden_door: 'axe',
  // Shovel blocks
  dirt: 'shovel', sand: 'shovel', gravel: 'shovel', clay: 'shovel',
  soul_sand: 'shovel', farmland: 'shovel', grass_block: 'shovel',
  mycelium: 'shovel', podzol: 'shovel', snow_layer: 'shovel', snow: 'shovel',
};

// Minimum tool tier required to get drops. Without this tier or above,
// the block breaks but drops NOTHING. Key Minecraft mechanic.
const TOOL_TIER_ORDER: ToolTier[] = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'];

const MIN_TOOL_TIER: Record<string, { tool: ToolType; tier: ToolTier }> = {
  // Stone-tier pickaxe minimum
  iron_ore: { tool: 'pickaxe', tier: 'stone' },
  deepslate_iron_ore: { tool: 'pickaxe', tier: 'stone' },
  copper_ore: { tool: 'pickaxe', tier: 'stone' },
  lapis_ore: { tool: 'pickaxe', tier: 'stone' },
  deepslate_lapis_ore: { tool: 'pickaxe', tier: 'stone' },
  // Iron-tier pickaxe minimum
  gold_ore: { tool: 'pickaxe', tier: 'iron' },
  deepslate_gold_ore: { tool: 'pickaxe', tier: 'iron' },
  diamond_ore: { tool: 'pickaxe', tier: 'iron' },
  deepslate_diamond_ore: { tool: 'pickaxe', tier: 'iron' },
  emerald_ore: { tool: 'pickaxe', tier: 'iron' },
  deepslate_emerald_ore: { tool: 'pickaxe', tier: 'iron' },
  redstone_ore: { tool: 'pickaxe', tier: 'iron' },
  deepslate_redstone_ore: { tool: 'pickaxe', tier: 'iron' },
  // Diamond-tier pickaxe minimum
  obsidian: { tool: 'pickaxe', tier: 'diamond' },
  crying_obsidian: { tool: 'pickaxe', tier: 'diamond' },
  ancient_debris: { tool: 'pickaxe', tier: 'diamond' },
  // Any pickaxe required (wooden+)
  stone: { tool: 'pickaxe', tier: 'wooden' },
  cobblestone: { tool: 'pickaxe', tier: 'wooden' },
  coal_ore: { tool: 'pickaxe', tier: 'wooden' },
  deepslate_coal_ore: { tool: 'pickaxe', tier: 'wooden' },
  sandstone: { tool: 'pickaxe', tier: 'wooden' },
  iron_block: { tool: 'pickaxe', tier: 'wooden' },
  gold_block: { tool: 'pickaxe', tier: 'iron' },
  diamond_block: { tool: 'pickaxe', tier: 'iron' },
  emerald_block: { tool: 'pickaxe', tier: 'iron' },
  brick: { tool: 'pickaxe', tier: 'wooden' },
  stone_bricks: { tool: 'pickaxe', tier: 'wooden' },
  mossy_stone_bricks: { tool: 'pickaxe', tier: 'wooden' },
  deepslate: { tool: 'pickaxe', tier: 'wooden' },
  netherrack: { tool: 'pickaxe', tier: 'wooden' },
  furnace: { tool: 'pickaxe', tier: 'wooden' },
};

// Max durability for tools and armor (total uses before breaking)
const MAX_DURABILITY: Record<string, number> = {
  // Tools by tier
  wooden_pickaxe: 59, wooden_axe: 59, wooden_shovel: 59, wooden_hoe: 59, wooden_sword: 59,
  stone_pickaxe: 131, stone_axe: 131, stone_shovel: 131, stone_hoe: 131, stone_sword: 131,
  iron_pickaxe: 250, iron_axe: 250, iron_shovel: 250, iron_hoe: 250, iron_sword: 250,
  golden_pickaxe: 32, golden_axe: 32, golden_shovel: 32, golden_hoe: 32, golden_sword: 32,
  diamond_pickaxe: 1561, diamond_axe: 1561, diamond_shovel: 1561, diamond_hoe: 1561, diamond_sword: 1561,
  netherite_pickaxe: 2031, netherite_axe: 2031, netherite_shovel: 2031, netherite_hoe: 2031, netherite_sword: 2031,
  // Armor by tier
  leather_helmet: 55, leather_chestplate: 80, leather_leggings: 75, leather_boots: 65,
  golden_helmet: 77, golden_chestplate: 112, golden_leggings: 105, golden_boots: 91,
  chainmail_helmet: 165, chainmail_chestplate: 240, chainmail_leggings: 225, chainmail_boots: 195,
  iron_helmet: 165, iron_chestplate: 240, iron_leggings: 225, iron_boots: 195,
  diamond_helmet: 363, diamond_chestplate: 528, diamond_leggings: 495, diamond_boots: 429,
  netherite_helmet: 407, netherite_chestplate: 592, netherite_leggings: 555, netherite_boots: 481,
  // Other
  shears: 238, flint_and_steel: 64, bow: 384, crossbow: 465,
  fishing_rod: 64, shield: 336, trident: 250, elytra: 432,
};

const BEDROCK_VERSION = 'bedrock_1.21.80';

export class DataLookup {
  private entityMap: Map<string, EntityInfo> = new Map();
  private itemMap: Map<string, ItemInfo> = new Map();
  private blockStateMap: Map<number, BlockInfo> = new Map();

  constructor() {
    const data = mcdata(BEDROCK_VERSION);

    // Build entity lookup: "zombie" -> EntityInfo
    for (const entity of data.entitiesArray) {
      const category = this.mapCategory(entity.category);
      this.entityMap.set(entity.name, {
        name: entity.name,
        displayName: entity.displayName || entity.name,
        category,
      });
    }

    // Build item lookup: "stone" -> ItemInfo
    for (const item of data.itemsArray) {
      this.itemMap.set(item.name, {
        name: item.name,
        displayName: item.displayName || item.name,
      });
    }

    // Build block state lookup: stateId -> BlockInfo
    if (data.blocksByStateId) {
      for (const [stateId, block] of Object.entries(data.blocksByStateId)) {
        this.blockStateMap.set(Number(stateId), {
          name: block.name,
          displayName: block.displayName || block.name,
        });
      }
    }
  }

  getEntityInfo(entityType: string): EntityInfo {
    // entityType comes as "minecraft:zombie" — strip prefix
    const name = entityType.replace('minecraft:', '');
    return this.entityMap.get(name) || {
      name,
      displayName: name.replace(/_/g, ' '),
      category: 'other',
    };
  }

  getItemName(itemStateName: string): string {
    // itemStateName comes as "minecraft:stone" — strip prefix
    const name = itemStateName.replace('minecraft:', '');
    const info = this.itemMap.get(name);
    return info ? info.displayName : name.replace(/_/g, ' ');
  }

  getBlockName(runtimeId: number): string {
    const info = this.blockStateMap.get(runtimeId);
    return info ? info.displayName : `block#${runtimeId}`;
  }

  // Get block hardness in seconds (bare hand). Returns -1 for unbreakable, 1.5 as default.
  getBlockHardness(blockName: string): number {
    const name = blockName.replace('minecraft:', '').toLowerCase();
    // Check exact match first
    if (name in BLOCK_HARDNESS) return BLOCK_HARDNESS[name];
    // Check partial match (e.g. "oak_log" matches "log")
    for (const [key, val] of Object.entries(BLOCK_HARDNESS)) {
      if (name.includes(key) || key.includes(name)) return val;
    }
    return 1.5; // default medium hardness
  }

  // Get the correct tool type for a block
  getEffectiveTool(blockName: string): ToolType | null {
    const name = blockName.replace('minecraft:', '').toLowerCase();
    if (name in TOOL_EFFECTIVENESS) return TOOL_EFFECTIVENESS[name];
    for (const [key, toolType] of Object.entries(TOOL_EFFECTIVENESS)) {
      if (name.includes(key) || key.includes(name)) return toolType;
    }
    return null;
  }

  // Calculate mining time in ms given block name and tool item name
  getMiningTimeMs(blockName: string, toolItemName?: string): number {
    const hardness = this.getBlockHardness(blockName);
    if (hardness <= 0) return hardness === 0 ? 50 : -1; // instant or unbreakable

    if (!toolItemName) {
      // Bare hand: hardness * 5 seconds (converted to ms) — capped at 15s
      return Math.min(hardness * 5 * 1000, 15000);
    }

    const toolInfo = this.parseToolName(toolItemName);
    if (!toolInfo) {
      return Math.min(hardness * 5 * 1000, 15000);
    }

    const effectiveTool = this.getEffectiveTool(blockName);
    if (effectiveTool && toolInfo.type === effectiveTool) {
      // Correct tool: hardness * 1.5 / speed_multiplier seconds
      const speed = TOOL_SPEED[toolInfo.tier] || 1;
      return Math.max((hardness * 1.5 / speed) * 1000, 50);
    }

    // Wrong tool type — still faster than bare hand but not optimal
    return Math.min(hardness * 5 * 1000, 15000);
  }

  // Parse a tool item name like "iron_pickaxe" into tier + type
  parseToolName(itemName: string): ToolInfo | null {
    const name = itemName.replace('minecraft:', '').toLowerCase();
    const tiers: ToolTier[] = ['netherite', 'diamond', 'golden', 'iron', 'stone', 'wooden'];
    const types: ToolType[] = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears'];

    let foundTier: ToolTier | null = null;
    let foundType: ToolType | null = null;

    for (const tier of tiers) {
      if (name.includes(tier)) { foundTier = tier; break; }
    }
    for (const type of types) {
      if (name.includes(type)) { foundType = type; break; }
    }

    if (!foundType) return null;
    return {
      tier: foundTier ?? 'wooden',
      type: foundType,
      speedMultiplier: TOOL_SPEED[foundTier ?? 'wooden'] || 1,
    };
  }

  // Check if a tool meets the minimum tier to get drops from a block.
  // Returns { canHarvest, reason } — reason explains why not if false.
  canHarvest(blockName: string, toolItemName?: string): { canHarvest: boolean; reason?: string } {
    const name = blockName.replace('minecraft:', '').toLowerCase();
    const req = this.getMinToolTier(name);
    if (!req) return { canHarvest: true }; // no requirement = anything works

    if (!toolItemName) {
      return { canHarvest: false, reason: `${name} requires at least a ${req.tier} ${req.tool} to drop items. You have bare hands.` };
    }

    const toolInfo = this.parseToolName(toolItemName);
    if (!toolInfo) {
      return { canHarvest: false, reason: `${name} requires at least a ${req.tier} ${req.tool}. "${toolItemName}" is not a valid tool.` };
    }

    if (toolInfo.type !== req.tool) {
      return { canHarvest: false, reason: `${name} requires a ${req.tool}, not a ${toolInfo.type}. Block will break but drop nothing.` };
    }

    const toolTierIdx = TOOL_TIER_ORDER.indexOf(toolInfo.tier);
    const reqTierIdx = TOOL_TIER_ORDER.indexOf(req.tier);
    // Golden tools have tier index 3 but are actually low-tier for harvesting
    // In Minecraft, golden pickaxe has same harvest level as wooden
    const effectiveToolIdx = toolInfo.tier === 'golden' ? 0 : toolTierIdx;
    const effectiveReqIdx = req.tier === 'golden' ? 0 : reqTierIdx;

    if (effectiveToolIdx < effectiveReqIdx) {
      return { canHarvest: false, reason: `${name} requires at least a ${req.tier} ${req.tool}. Your ${toolInfo.tier} ${toolInfo.type} is too weak — block will break but drop nothing.` };
    }

    return { canHarvest: true };
  }

  // Get minimum tool tier requirement for a block (null = no requirement)
  getMinToolTier(blockName: string): { tool: ToolType; tier: ToolTier } | null {
    const name = blockName.replace('minecraft:', '').toLowerCase();
    if (name in MIN_TOOL_TIER) return MIN_TOOL_TIER[name];
    // Partial match
    for (const [key, req] of Object.entries(MIN_TOOL_TIER)) {
      if (name.includes(key) || key.includes(name)) return req;
    }
    return null;
  }

  // Find the best tool in a list of item names for mining a specific block
  getBestToolForBlock(blockName: string, items: { name: string; slot: number }[]): { name: string; slot: number } | null {
    const effectiveTool = this.getEffectiveTool(blockName);
    if (!effectiveTool) return null;

    let bestItem: { name: string; slot: number } | null = null;
    let bestSpeed = 0;

    for (const item of items) {
      const toolInfo = this.parseToolName(item.name);
      if (toolInfo && toolInfo.type === effectiveTool) {
        if (toolInfo.speedMultiplier > bestSpeed) {
          bestSpeed = toolInfo.speedMultiplier;
          bestItem = item;
        }
      }
    }

    return bestItem;
  }

  // Get max durability for a tool/armor item. Returns 0 if not a durable item.
  getMaxDurability(itemName: string): number {
    const name = itemName.replace('minecraft:', '').toLowerCase();
    return MAX_DURABILITY[name] ?? 0;
  }

  // Get remaining durability as a percentage (0-100). Returns null for non-durable items.
  getDurabilityPercent(itemName: string, damage: number): number | null {
    const max = this.getMaxDurability(itemName);
    if (max === 0) return null;
    const remaining = Math.max(0, max - damage);
    return Math.round((remaining / max) * 100);
  }

  private mapCategory(raw?: string): 'hostile' | 'passive' | 'neutral' | 'other' {
    if (!raw) return 'other';
    const lower = raw.toLowerCase();
    if (lower.includes('hostile')) return 'hostile';
    if (lower.includes('passive')) return 'passive';
    return 'other';
  }
}
