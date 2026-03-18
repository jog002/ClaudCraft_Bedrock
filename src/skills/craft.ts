/**
 * Crafting skill.
 * Cheat mode: uses /give to bypass crafting entirely.
 * Survival mode: sends item_stack_request with CraftRecipe action.
 *
 * Note: Full survival crafting requires the server to send crafting_data
 * with recipe network IDs. For now, survival mode opens the crafting interface
 * and attempts to craft using the recipe system.
 */
import { Action, ActionResult, SkillContext } from './types';

// Common crafting recipes — maps output item name to required inputs
// Used to validate crafting requests and provide feedback
const BASIC_RECIPES: Record<string, { ingredients: Record<string, number>; count: number }> = {
  oak_planks: { ingredients: { oak_log: 1 }, count: 4 },
  birch_planks: { ingredients: { birch_log: 1 }, count: 4 },
  spruce_planks: { ingredients: { spruce_log: 1 }, count: 4 },
  jungle_planks: { ingredients: { jungle_log: 1 }, count: 4 },
  acacia_planks: { ingredients: { acacia_log: 1 }, count: 4 },
  dark_oak_planks: { ingredients: { dark_oak_log: 1 }, count: 4 },
  stick: { ingredients: { planks: 2 }, count: 4 },
  crafting_table: { ingredients: { planks: 4 }, count: 1 },
  chest: { ingredients: { planks: 8 }, count: 1 },
  furnace: { ingredients: { cobblestone: 8 }, count: 1 },
  wooden_pickaxe: { ingredients: { planks: 3, stick: 2 }, count: 1 },
  wooden_axe: { ingredients: { planks: 3, stick: 2 }, count: 1 },
  wooden_shovel: { ingredients: { planks: 1, stick: 2 }, count: 1 },
  wooden_sword: { ingredients: { planks: 2, stick: 1 }, count: 1 },
  stone_pickaxe: { ingredients: { cobblestone: 3, stick: 2 }, count: 1 },
  stone_axe: { ingredients: { cobblestone: 3, stick: 2 }, count: 1 },
  stone_shovel: { ingredients: { cobblestone: 1, stick: 2 }, count: 1 },
  stone_sword: { ingredients: { cobblestone: 2, stick: 1 }, count: 1 },
  iron_pickaxe: { ingredients: { iron_ingot: 3, stick: 2 }, count: 1 },
  iron_axe: { ingredients: { iron_ingot: 3, stick: 2 }, count: 1 },
  iron_shovel: { ingredients: { iron_ingot: 1, stick: 2 }, count: 1 },
  iron_sword: { ingredients: { iron_ingot: 2, stick: 1 }, count: 1 },
  diamond_pickaxe: { ingredients: { diamond: 3, stick: 2 }, count: 1 },
  diamond_axe: { ingredients: { diamond: 3, stick: 2 }, count: 1 },
  diamond_shovel: { ingredients: { diamond: 1, stick: 2 }, count: 1 },
  diamond_sword: { ingredients: { diamond: 2, stick: 1 }, count: 1 },
  torch: { ingredients: { stick: 1, coal: 1 }, count: 4 },
  iron_ingot: { ingredients: { iron_nugget: 9 }, count: 1 },
  gold_ingot: { ingredients: { gold_nugget: 9 }, count: 1 },
  iron_block: { ingredients: { iron_ingot: 9 }, count: 1 },
  gold_block: { ingredients: { gold_ingot: 9 }, count: 1 },
  diamond_block: { ingredients: { diamond: 9 }, count: 1 },
  bucket: { ingredients: { iron_ingot: 3 }, count: 1 },
  rails: { ingredients: { iron_ingot: 6, stick: 1 }, count: 16 },
  ladder: { ingredients: { stick: 7 }, count: 3 },
  fence: { ingredients: { planks: 4, stick: 2 }, count: 3 },
  wooden_door: { ingredients: { planks: 6 }, count: 3 },
  bed: { ingredients: { planks: 3, wool: 3 }, count: 1 },
  boat: { ingredients: { planks: 5 }, count: 1 },
  bow: { ingredients: { stick: 3, string: 3 }, count: 1 },
  arrow: { ingredients: { flint: 1, stick: 1, feather: 1 }, count: 4 },
};

// ─── Cheat Mode ─────────────────────────────────────────────────────────

export async function executeCheatCraft(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'craft') {
    return { success: false, message: 'Invalid action type', actionType: 'craft' };
  }

  const itemName = action.item.replace('minecraft:', '');
  const requestedCount = action.count ?? 1;

  // In cheat mode, just give the item directly
  const recipe = BASIC_RECIPES[itemName];
  const giveCount = recipe ? recipe.count * requestedCount : requestedCount;

  ctx.connection.sendCommand(`give @s ${itemName} ${giveCount}`);
  await sleep(300);

  return {
    success: true,
    message: `Crafted ${giveCount}x ${itemName}`,
    actionType: 'craft',
  };
}

// ─── Survival Mode ──────────────────────────────────────────────────────

export async function executeSurvivalCraft(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'craft') {
    return { success: false, message: 'Invalid action type', actionType: 'craft' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'craft' };
  }

  const itemName = action.item.replace('minecraft:', '').toLowerCase();
  const recipe = BASIC_RECIPES[itemName];

  if (!recipe) {
    return {
      success: false,
      message: `Unknown recipe for "${action.item}". Try crafting common items like planks, sticks, tools.`,
      actionType: 'craft',
    };
  }

  // Check if we have the ingredients
  const missing: string[] = [];
  for (const [ingredient, needed] of Object.entries(recipe.ingredients)) {
    const found = ctx.worldState.findInventoryItem(ingredient);
    if (!found || found.item.count < needed) {
      const have = found?.item.count ?? 0;
      missing.push(`${ingredient} (need ${needed}, have ${have})`);
    }
  }

  if (missing.length > 0) {
    return {
      success: false,
      message: `Missing materials: ${missing.join(', ')}`,
      actionType: 'craft',
    };
  }

  // Check if inventory has space for the output
  let emptySlots = 0;
  for (let i = 0; i < 36; i++) {
    if (!ctx.worldState.inventory.has(i)) emptySlots++;
  }
  if (emptySlots === 0) {
    return {
      success: false,
      message: 'Inventory is full — drop or store items before crafting.',
      actionType: 'craft',
    };
  }

  // Check if we need a crafting table (recipes with > 4 ingredients or 3x3 grid items)
  const needsCraftingTable = Object.values(recipe.ingredients).reduce((a, b) => a + b, 0) > 4
    || ['pickaxe', 'axe', 'sword', 'shovel', 'furnace', 'chest', 'door', 'bed', 'boat', 'bow'].some(t => itemName.includes(t));

  if (needsCraftingTable && !ctx.worldState.openContainer) {
    return {
      success: false,
      message: `Crafting ${itemName} requires a crafting table. Use openContainer at a crafting table first.`,
      actionType: 'craft',
    };
  }

  // Send craft request via item_stack_request
  // The server validates recipes — we request with CraftRecipe action
  try {
    const requestId = Math.floor(Math.random() * 2147483647);

    // Look up the real recipe_network_id from server's crafting_data
    const recipeNetworkId = ctx.worldState.recipeMap.get(itemName) ?? 0;
    if (recipeNetworkId === 0) {
      return {
        success: false,
        message: `No server recipe found for "${itemName}". The server has not sent a matching crafting_data entry.`,
        actionType: 'craft',
      };
    }

    client.queue('item_stack_request' as any, {
      requests: [{
        request_id: requestId,
        actions: [{
          type_id: 'craft_recipe',
          recipe_network_id: recipeNetworkId,
          times_crafted: action.count ?? 1,
        }],
        custom_names: [],
        cause: 0,
      }],
    });

    await sleep(500);

    return {
      success: true,
      message: `Attempted to craft ${recipe.count * (action.count ?? 1)}x ${itemName}. Check inventory for result.`,
      actionType: 'craft',
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Craft failed: ${err.message}`,
      actionType: 'craft',
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
