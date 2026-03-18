/**
 * Interaction skills — eating food, sleeping in beds.
 * Uses raw bedrock-protocol packets.
 */
import { Action, ActionResult, SkillContext } from './types';

// Foods that can be eaten (partial list — covers common items)
const FOOD_ITEMS = new Set([
  'apple', 'baked_potato', 'beetroot', 'beetroot_soup', 'bread',
  'carrot', 'chorus_fruit', 'cooked_beef', 'cooked_chicken', 'cooked_cod',
  'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit', 'cooked_salmon',
  'cookie', 'dried_kelp', 'enchanted_golden_apple', 'golden_apple',
  'golden_carrot', 'honey_bottle', 'melon_slice', 'mushroom_stew',
  'poisonous_potato', 'potato', 'pumpkin_pie', 'rabbit_stew',
  'raw_beef', 'raw_chicken', 'raw_cod', 'raw_mutton', 'raw_porkchop',
  'raw_rabbit', 'raw_salmon', 'rotten_flesh', 'spider_eye',
  'steak', 'sweet_berries', 'glow_berries', 'suspicious_stew',
  'beef', 'chicken', 'cod', 'mutton', 'porkchop', 'rabbit', 'salmon',
]);

function isFood(itemName: string): boolean {
  const name = itemName.replace('minecraft:', '').toLowerCase();
  return FOOD_ITEMS.has(name);
}

// ─── Eat Food ────────────────────────────────────────────────────────

export async function executeCheatEatFood(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'eatFood') {
    return { success: false, message: 'Invalid action type', actionType: 'eatFood' };
  }

  // In cheat mode, just restore hunger directly
  ctx.connection.sendCommand('effect @s saturation 1 255 true');
  await sleep(300);
  return { success: true, message: 'Restored hunger (cheat)', actionType: 'eatFood' };
}

export async function executeSurvivalEatFood(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'eatFood') {
    return { success: false, message: 'Invalid action type', actionType: 'eatFood' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'eatFood' };
  }

  // Find food in hotbar first, then inventory
  let foodSlot = -1;
  let foodName = '';

  // If specific food requested, search for it
  const searchName = action.item?.toLowerCase() ?? '';

  for (let slot = 0; slot < 9; slot++) {
    const item = ctx.worldState.getHotbarItem(slot);
    if (item && isFood(item.name)) {
      if (!searchName || item.name.toLowerCase().includes(searchName)) {
        foodSlot = slot;
        foodName = item.name;
        break;
      }
    }
  }

  if (foodSlot === -1) {
    // Check full inventory
    for (const [slot, item] of ctx.worldState.inventory) {
      if (slot >= 9 && isFood(item.name)) {
        if (!searchName || item.name.toLowerCase().includes(searchName)) {
          // Need to move to hotbar first — find empty slot or use slot 8
          let targetHotbar = -1;
          for (let s = 0; s < 9; s++) {
            if (!ctx.worldState.getHotbarItem(s)) { targetHotbar = s; break; }
          }
          if (targetHotbar === -1) targetHotbar = 8;

          // Swap
          const requestId = Math.floor(Math.random() * 2147483647);
          client.queue('item_stack_request' as any, {
            requests: [{
              request_id: requestId,
              actions: [{
                type_id: 'swap',
                source: { slot_type: { container_id: 'inventory' }, slot, stack_id: 0 },
                destination: { slot_type: { container_id: 'hotbar' }, slot: targetHotbar, stack_id: 0 },
              }],
              custom_names: [],
              cause: 0,
            }],
          });

          // Update local state
          const existing = ctx.worldState.getHotbarItem(targetHotbar);
          ctx.worldState.inventory.set(targetHotbar, { ...item, slot: targetHotbar });
          if (existing) {
            ctx.worldState.inventory.set(slot, { ...existing, slot });
          } else {
            ctx.worldState.inventory.delete(slot);
          }

          await sleep(300);
          foodSlot = targetHotbar;
          foodName = item.name;
          break;
        }
      }
    }
  }

  if (foodSlot === -1) {
    return {
      success: false,
      message: searchName ? `No "${searchName}" found in inventory` : 'No food found in inventory',
      actionType: 'eatFood',
    };
  }

  // Select the food slot
  const foodItem = ctx.worldState.getHotbarItem(foodSlot);
  const networkId = foodItem?.networkId ?? 0;
  client.queue('mob_equipment' as any, {
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    item: { network_id: networkId, count: networkId ? (foodItem?.count ?? 1) : 0, metadata: 0, has_stack_id: 0, block_runtime_id: 0 },
    slot: foodSlot,
    selected_slot: foodSlot,
    window_id: 'inventory',
  });
  ctx.worldState.heldSlot = foodSlot;
  await sleep(100);

  const pos = ctx.worldState.bot.position;

  // Start eating (player_action with start_item_use_on — use on air to eat)
  client.queue('inventory_transaction' as any, {
    transaction: {
      legacy: { legacy_request_id: 0, legacy_transactions: [] },
      transaction_type: 'item_use',
      actions: [],
      transaction_data: {
        action_type: 'click_air',
        trigger_type: 'player_input',
        block_position: { x: 0, y: 0, z: 0 },
        face: 0xff,
        hotbar_slot: foodSlot,
        held_item: { network_id: networkId, count: foodItem?.count ?? 1, metadata: 0, has_stack_id: 0, block_runtime_id: 0 },
        player_pos: { x: pos.x, y: pos.y, z: pos.z },
        click_pos: { x: 0, y: 0, z: 0 },
        block_runtime_id: 0,
        client_prediction: 'success',
      },
    },
  });

  // Eating takes ~1.6 seconds in Minecraft
  await sleep(1700);

  // Complete eating
  client.queue('player_action' as any, {
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    action: 'stop_item_use_on',
    position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
    result_position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
    face: 0,
  });

  await sleep(200);

  return {
    success: true,
    message: `Ate ${foodName}`,
    actionType: 'eatFood',
  };
}

// ─── Sleep in Bed ───────────────────────────────────────────────────

export async function executeCheatSleepInBed(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'sleepInBed') {
    return { success: false, message: 'Invalid action type', actionType: 'sleepInBed' };
  }

  // In cheat mode, just set time to day
  ctx.connection.sendCommand('time set day');
  await sleep(300);
  return { success: true, message: 'Set time to day (cheat)', actionType: 'sleepInBed' };
}

export async function executeSurvivalSleepInBed(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'sleepInBed') {
    return { success: false, message: 'Invalid action type', actionType: 'sleepInBed' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'sleepInBed' };
  }

  const { x, y, z } = action;
  const pos = ctx.worldState.bot.position;

  // Check distance to bed
  const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2 + (z - pos.z) ** 2);
  if (dist > 4) {
    return {
      success: false,
      message: `Bed at (${x}, ${y}, ${z}) is too far (${dist.toFixed(0)} blocks). Walk closer first.`,
      actionType: 'sleepInBed',
    };
  }

  // Check time — can only sleep at night or during thunder
  const time = ctx.worldState.worldTime % 24000;
  if (time >= 0 && time < 12542) {
    return {
      success: false,
      message: 'Can only sleep at night or during a thunderstorm.',
      actionType: 'sleepInBed',
    };
  }

  // Interact with bed block (same as openContainer — click_block on the bed)
  client.queue('inventory_transaction' as any, {
    transaction: {
      legacy: { legacy_request_id: 0, legacy_transactions: [] },
      transaction_type: 'item_use',
      actions: [],
      transaction_data: {
        action_type: 'click_block',
        trigger_type: 'player_input',
        block_position: { x, y, z },
        face: 1,
        hotbar_slot: ctx.worldState.heldSlot,
        held_item: { network_id: 0, count: 0, metadata: 0, has_stack_id: 0, block_runtime_id: 0 },
        player_pos: { x: pos.x, y: pos.y, z: pos.z },
        click_pos: { x: 0.5, y: 0.5, z: 0.5 },
        block_runtime_id: 0,
        client_prediction: 'success',
      },
    },
  });

  // Wait for time to pass (sleeping takes a few seconds in multiplayer, instant in SP)
  await sleep(2000);

  return {
    success: true,
    message: `Sleeping in bed at (${x}, ${y}, ${z}). Spawn point set.`,
    actionType: 'sleepInBed',
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
