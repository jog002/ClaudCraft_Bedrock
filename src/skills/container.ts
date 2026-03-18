/**
 * Container interaction skills — chests, crafting tables, furnaces.
 * Cheat mode: uses commands to manipulate containers.
 * Survival mode: sends interact + inventory_transaction packets.
 */
import { Action, ActionResult, SkillContext } from './types';

// ─── Open Container ─────────────────────────────────────────────────────

export async function executeCheatOpenContainer(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'openContainer') {
    return { success: false, message: 'Invalid action type', actionType: 'openContainer' };
  }

  const { x, y, z } = action;
  // Teleport close to the container first
  ctx.connection.sendCommand(`tp @s ${x} ${y + 1} ${z}`);
  await sleep(300);

  return {
    success: true,
    message: `Moved to container at (${x}, ${y}, ${z}). In cheat mode, use giveItem/clearInventory instead.`,
    actionType: 'openContainer',
  };
}

export async function executeSurvivalOpenContainer(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'openContainer') {
    return { success: false, message: 'Invalid action type', actionType: 'openContainer' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'openContainer' };
  }

  const { x, y, z } = action;
  const pos = ctx.worldState.bot.position;

  // Check distance
  const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2 + (z - pos.z) ** 2);
  if (dist > 6) {
    return {
      success: false,
      message: `Container at (${x}, ${y}, ${z}) is too far (${dist.toFixed(0)} blocks). Walk closer first.`,
      actionType: 'openContainer',
    };
  }

  // Face the container
  const dx = x + 0.5 - pos.x;
  const dz = z + 0.5 - pos.z;
  const dy = y + 0.5 - pos.y;
  const hdist = Math.sqrt(dx * dx + dz * dz);
  const yaw = -Math.atan2(dx, dz) * (180 / Math.PI);
  const pitch = -Math.atan2(dy, hdist) * (180 / Math.PI);

  ctx.worldState.bot.yaw = yaw;
  ctx.worldState.bot.pitch = pitch;
  client.queue('move_player' as any, {
    runtime_id: Number(ctx.worldState.getBotRuntimeId()),
    position: { x: pos.x, y: pos.y, z: pos.z },
    pitch, yaw, head_yaw: yaw,
    mode: 'normal', on_ground: true, ridden_runtime_id: 0, tick: 0,
  });
  await sleep(100);

  // Send interact/use on block (same as placeBlock but for containers)
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

  // Wait for server to send container_open
  await sleep(500);

  if (ctx.worldState.openContainer) {
    return {
      success: true,
      message: `Opened ${ctx.worldState.openContainer.windowType} at (${x}, ${y}, ${z})`,
      actionType: 'openContainer',
    };
  }

  return {
    success: false,
    message: `No container response from server. Block at (${x}, ${y}, ${z}) may not be a container.`,
    actionType: 'openContainer',
  };
}

// ─── Close Container ────────────────────────────────────────────────────

export async function executeCloseContainer(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'closeContainer') {
    return { success: false, message: 'Invalid action type', actionType: 'closeContainer' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'closeContainer' };
  }

  if (!ctx.worldState.openContainer) {
    return { success: true, message: 'No container currently open', actionType: 'closeContainer' };
  }

  const windowType = ctx.worldState.openContainer.windowType;
  client.queue('container_close' as any, {
    window_id: ctx.worldState.openContainer.windowId,
    window_type: windowType,
    server: false,
  });

  ctx.worldState.openContainer = null;
  await sleep(200);

  return { success: true, message: `Closed ${windowType}`, actionType: 'closeContainer' };
}

// ─── Store Item ─────────────────────────────────────────────────────────

export async function executeCheatStoreItem(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'storeItem') {
    return { success: false, message: 'Invalid action type', actionType: 'storeItem' };
  }
  // In cheat mode, just clear the item from inventory
  const count = action.count ?? 1;
  ctx.connection.sendCommand(`clear @s ${action.item} 0 ${count}`);
  await sleep(300);
  return { success: true, message: `Stored ${count}x ${action.item}`, actionType: 'storeItem' };
}

export async function executeSurvivalStoreItem(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'storeItem') {
    return { success: false, message: 'Invalid action type', actionType: 'storeItem' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'storeItem' };
  }

  if (!ctx.worldState.openContainer) {
    return { success: false, message: 'No container is open. Use openContainer first.', actionType: 'storeItem' };
  }

  // Find item in inventory
  const found = ctx.worldState.findInventoryItem(action.item);
  if (!found) {
    return { success: false, message: `No "${action.item}" found in inventory`, actionType: 'storeItem' };
  }

  // Find empty slot in container (detect size from window type)
  let targetSlot = -1;
  const containerSlots = ctx.worldState.openContainer.slots;
  const maxSlots = getContainerSize(ctx.worldState.openContainer.windowType);
  for (let i = 0; i < maxSlots; i++) {
    if (!containerSlots.has(i)) {
      targetSlot = i;
      break;
    }
  }

  if (targetSlot === -1) {
    return { success: false, message: 'Container is full', actionType: 'storeItem' };
  }

  const count = Math.min(action.count ?? found.item.count, found.item.count);

  // Send item_stack_request to move item from inventory to container
  const requestId = Math.floor(Math.random() * 2147483647);
  client.queue('item_stack_request' as any, {
    requests: [{
      request_id: requestId,
      actions: [
        {
          type_id: 'take',
          count,
          source: {
            slot_type: { container_id: 'inventory' },
            slot: found.slot,
            stack_id: 0,
          },
          destination: {
            slot_type: { container_id: 'level_entity' },
            slot: targetSlot,
            stack_id: 0,
          },
        },
      ],
      custom_names: [],
      cause: 0,
    }],
  });

  await sleep(300);

  return {
    success: true,
    message: `Stored ${count}x ${found.item.name} in container slot ${targetSlot}`,
    actionType: 'storeItem',
  };
}

// ─── Retrieve Item ──────────────────────────────────────────────────────

export async function executeCheatRetrieveItem(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'retrieveItem') {
    return { success: false, message: 'Invalid action type', actionType: 'retrieveItem' };
  }
  const count = action.count ?? 1;
  ctx.connection.sendCommand(`give @s ${action.item} ${count}`);
  await sleep(300);
  return { success: true, message: `Retrieved ${count}x ${action.item}`, actionType: 'retrieveItem' };
}

export async function executeSurvivalRetrieveItem(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'retrieveItem') {
    return { success: false, message: 'Invalid action type', actionType: 'retrieveItem' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'retrieveItem' };
  }

  if (!ctx.worldState.openContainer) {
    return { success: false, message: 'No container is open. Use openContainer first.', actionType: 'retrieveItem' };
  }

  // Find item in container
  const itemName = action.item.toLowerCase();
  let sourceSlot = -1;
  let sourceItem: { name: string; count: number } | null = null;

  for (const [slot, item] of ctx.worldState.openContainer.slots) {
    if (item.name.toLowerCase().includes(itemName)) {
      sourceSlot = slot;
      sourceItem = item;
      break;
    }
  }

  if (sourceSlot === -1 || !sourceItem) {
    return { success: false, message: `No "${action.item}" found in container`, actionType: 'retrieveItem' };
  }

  // Find empty inventory slot
  let destSlot = -1;
  for (let i = 0; i < 36; i++) {
    if (!ctx.worldState.inventory.has(i)) {
      destSlot = i;
      break;
    }
  }

  if (destSlot === -1) {
    return { success: false, message: 'Inventory is full', actionType: 'retrieveItem' };
  }

  const count = Math.min(action.count ?? sourceItem.count, sourceItem.count);

  const requestId = Math.floor(Math.random() * 2147483647);
  client.queue('item_stack_request' as any, {
    requests: [{
      request_id: requestId,
      actions: [
        {
          type_id: 'take',
          count,
          source: {
            slot_type: { container_id: 'level_entity' },
            slot: sourceSlot,
            stack_id: 0,
          },
          destination: {
            slot_type: { container_id: 'inventory' },
            slot: destSlot,
            stack_id: 0,
          },
        },
      ],
      custom_names: [],
      cause: 0,
    }],
  });

  await sleep(300);

  return {
    success: true,
    message: `Retrieved ${count}x ${sourceItem.name} from container`,
    actionType: 'retrieveItem',
  };
}

/** Returns the number of slots for a container window type. */
function getContainerSize(windowType: string): number {
  const lower = windowType.toLowerCase();
  if (lower.includes('double') || lower.includes('generic_54')) return 54;
  if (lower.includes('chest') || lower.includes('barrel') || lower.includes('generic_27') || lower.includes('shulker')) return 27;
  if (lower.includes('hopper')) return 5;
  if (lower.includes('dropper') || lower.includes('dispenser')) return 9;
  if (lower.includes('furnace') || lower.includes('blast') || lower.includes('smoker')) return 3;
  if (lower.includes('brewing')) return 5;
  if (lower.includes('crafting') || lower.includes('workbench')) return 10;
  if (lower.includes('enchant')) return 2;
  if (lower.includes('anvil') || lower.includes('grindstone') || lower.includes('smithing') || lower.includes('stonecutter') || lower.includes('cartography') || lower.includes('loom')) return 3;
  return 27; // default fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
