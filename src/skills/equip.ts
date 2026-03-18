/**
 * Equipment / hotbar management skills.
 * Cheat mode: uses /replaceitem command.
 * Survival mode: sends mob_equipment packet to select hotbar slot.
 */
import { Action, ActionResult, SkillContext } from './types';

// ─── Cheat Mode ─────────────────────────────────────────────────────────

export async function executeCheatEquipItem(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'equipItem') {
    return { success: false, message: 'Invalid action type', actionType: 'equipItem' };
  }

  if (action.item) {
    // Use /replaceitem to put item in hand
    ctx.connection.sendCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${action.item}`);
    await sleep(300);
    return { success: true, message: `Equipped ${action.item}`, actionType: 'equipItem' };
  }

  if (action.slot !== undefined) {
    // In cheat mode, just update held slot — no direct command for this
    // but we can track it locally
    ctx.worldState.heldSlot = action.slot;
    return { success: true, message: `Selected hotbar slot ${action.slot}`, actionType: 'equipItem' };
  }

  return { success: false, message: 'Must specify item name or slot number', actionType: 'equipItem' };
}

// ─── Survival Mode ──────────────────────────────────────────────────────

export async function executeSurvivalEquipItem(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'equipItem') {
    return { success: false, message: 'Invalid action type', actionType: 'equipItem' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'equipItem' };
  }

  let targetSlot: number;

  if (action.slot !== undefined) {
    if (action.slot < 0 || action.slot > 8) {
      return { success: false, message: 'Slot must be 0-8 (hotbar)', actionType: 'equipItem' };
    }
    targetSlot = action.slot;
  } else if (action.item) {
    // First check hotbar (slots 0-8)
    const hotbarFound = ctx.worldState.findHotbarItem(action.item);
    if (hotbarFound) {
      targetSlot = hotbarFound.slot;
    } else {
      // Check full inventory (slots 9+)
      const invFound = ctx.worldState.findInventoryItem(action.item);
      if (!invFound || invFound.slot < 9) {
        return {
          success: false,
          message: `No "${action.item}" found in inventory`,
          actionType: 'equipItem',
        };
      }

      // Find an available hotbar slot (prefer empty, fallback to least useful)
      let freeHotbarSlot = -1;
      for (let s = 0; s < 9; s++) {
        if (!ctx.worldState.getHotbarItem(s)) {
          freeHotbarSlot = s;
          break;
        }
      }
      if (freeHotbarSlot === -1) {
        // No empty slot — use slot 8 (rightmost) as swap slot
        freeHotbarSlot = 8;
      }

      // Move item from inventory to hotbar via item_stack_request
      const requestId = Math.floor(Math.random() * 2147483647);
      client.queue('item_stack_request' as any, {
        requests: [{
          request_id: requestId,
          actions: [
            {
              type_id: 'swap',
              source: {
                slot_type: { container_id: 'inventory' },
                slot: invFound.slot,
                stack_id: 0,
              },
              destination: {
                slot_type: { container_id: 'hotbar' },
                slot: freeHotbarSlot,
                stack_id: 0,
              },
            },
          ],
          custom_names: [],
          cause: 0,
        }],
      });

      // Update local inventory state immediately so subsequent actions see correct slots
      const existingHotbarItem = ctx.worldState.getHotbarItem(freeHotbarSlot);
      ctx.worldState.inventory.set(freeHotbarSlot, { ...invFound.item, slot: freeHotbarSlot });
      if (existingHotbarItem) {
        ctx.worldState.inventory.set(invFound.slot, { ...existingHotbarItem, slot: invFound.slot });
      } else {
        ctx.worldState.inventory.delete(invFound.slot);
      }

      await sleep(300);
      targetSlot = freeHotbarSlot;
    }
  } else {
    return { success: false, message: 'Must specify item name or slot number', actionType: 'equipItem' };
  }

  // Send mob_equipment packet to select this hotbar slot
  const item = ctx.worldState.getHotbarItem(targetSlot);
  const networkId = item?.networkId ?? 0;
  client.queue('mob_equipment' as any, {
    runtime_entity_id: ctx.worldState.getBotRuntimeId(),
    item: { network_id: networkId, count: networkId ? (item?.count ?? 1) : 0, metadata: 0, has_stack_id: 0, block_runtime_id: 0 },
    slot: targetSlot,
    selected_slot: targetSlot,
    window_id: 'inventory',
  });

  ctx.worldState.heldSlot = targetSlot;

  const itemName = item?.name ?? action.item ?? 'empty';
  return {
    success: true,
    message: `Equipped slot ${targetSlot} (${itemName})`,
    actionType: 'equipItem',
  };
}

// ─── Armor ────────────────────────────────────────────────────────────────

// Maps item name keywords to armor slot index
const ARMOR_SLOT_MAP: Record<string, number> = {
  helmet: 0, cap: 0, hat: 0,
  chestplate: 1, tunic: 1, shirt: 1,
  leggings: 2, pants: 2, greaves: 2,
  boots: 3, shoes: 3,
};

function getArmorSlot(itemName: string): number | null {
  const lower = itemName.toLowerCase();
  for (const [keyword, slot] of Object.entries(ARMOR_SLOT_MAP)) {
    if (lower.includes(keyword)) return slot;
  }
  return null;
}

export async function executeCheatEquipArmor(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'equipArmor') {
    return { success: false, message: 'Invalid action type', actionType: 'equipArmor' };
  }

  const itemName = action.item.replace('minecraft:', '');
  const slotIdx = getArmorSlot(itemName);
  if (slotIdx === null) {
    return { success: false, message: `"${action.item}" is not a recognized armor piece (helmet, chestplate, leggings, boots)`, actionType: 'equipArmor' };
  }

  const slotNames = ['slot.armor.head', 'slot.armor.chest', 'slot.armor.legs', 'slot.armor.feet'];
  ctx.connection.sendCommand(`replaceitem entity @s ${slotNames[slotIdx]} 0 ${itemName}`);
  await sleep(300);
  return { success: true, message: `Equipped ${itemName}`, actionType: 'equipArmor' };
}

export async function executeSurvivalEquipArmor(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'equipArmor') {
    return { success: false, message: 'Invalid action type', actionType: 'equipArmor' };
  }

  const client = ctx.connection.getClient();
  if (!client) {
    return { success: false, message: 'Not connected', actionType: 'equipArmor' };
  }

  const itemName = action.item.replace('minecraft:', '').toLowerCase();
  const armorSlot = getArmorSlot(itemName);
  if (armorSlot === null) {
    return { success: false, message: `"${action.item}" is not a recognized armor piece (helmet, chestplate, leggings, boots)`, actionType: 'equipArmor' };
  }

  // Find the armor item in inventory
  const found = ctx.worldState.findInventoryItem(itemName);
  if (!found) {
    return { success: false, message: `No "${action.item}" found in inventory`, actionType: 'equipArmor' };
  }

  // Use item_stack_request to move from inventory to armor slot
  const requestId = Math.floor(Math.random() * 2147483647);
  const armorContainerIds = ['armor_head', 'armor_torso', 'armor_legs', 'armor_feet'];

  client.queue('item_stack_request' as any, {
    requests: [{
      request_id: requestId,
      actions: [
        {
          type_id: 'take',
          count: 1,
          source: {
            slot_type: { container_id: 'inventory' },
            slot: found.slot,
            stack_id: 0,
          },
          destination: {
            slot_type: { container_id: armorContainerIds[armorSlot] },
            slot: 0,
            stack_id: 0,
          },
        },
      ],
      custom_names: [],
      cause: 0,
    }],
  });

  await sleep(300);

  const slotNames = ['helmet', 'chestplate', 'leggings', 'boots'];
  return {
    success: true,
    message: `Equipped ${found.item.name} as ${slotNames[armorSlot]}`,
    actionType: 'equipArmor',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
