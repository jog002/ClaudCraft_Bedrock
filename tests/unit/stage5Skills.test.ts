import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionDispatcher } from '../../src/skills/actionDispatcher';
import { SkillContext } from '../../src/skills/types';
import { WorldState } from '../../src/bot/worldState';

function mockConnection() {
  return {
    sendChat: vi.fn(),
    sendCommand: vi.fn(),
    getBotName: () => 'TestBot',
    getClient: () => ({
      queue: vi.fn(),
    }),
  } as any;
}

function makeCtx(): SkillContext {
  return {
    connection: mockConnection(),
    worldState: new WorldState(),
  };
}

describe('Stage 5 Skills', () => {
  // ─── equipItem ──────────────────────────────────────────────────────

  describe('equipItem (cheat mode)', () => {
    it('equips item by name via /replaceitem', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Equip a sword',
        actions: [{ type: 'equipItem', item: 'diamond_sword' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].actionType).toBe('equipItem');
      expect(ctx.connection.sendCommand).toHaveBeenCalledWith(
        expect.stringContaining('replaceitem')
      );
    });

    it('selects hotbar slot by number', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Switch slot',
        actions: [{ type: 'equipItem', slot: 3 }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(ctx.worldState.heldSlot).toBe(3);
    });

    it('fails without item or slot', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Equip nothing?',
        actions: [{ type: 'equipItem' }],
      });

      expect(results[0].success).toBe(false);
    });
  });

  describe('equipItem (survival mode)', () => {
    it('selects hotbar slot by item name', async () => {
      const ctx = makeCtx();
      ctx.worldState.inventory.set(2, { slot: 2, name: 'iron_pickaxe', count: 1 });
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Equip pickaxe',
        actions: [{ type: 'equipItem', item: 'pickaxe' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(ctx.worldState.heldSlot).toBe(2);
    });

    it('moves item from inventory to hotbar when not in hotbar', async () => {
      const ctx = makeCtx();
      // Item in slot 10 (not hotbar) — should be moved to hotbar automatically
      ctx.worldState.inventory.set(10, { slot: 10, name: 'iron_pickaxe', count: 1 });
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Equip pickaxe',
        actions: [{ type: 'equipItem', item: 'pickaxe' }],
      });

      expect(results[0].success).toBe(true);
      expect(results[0].message).toContain('Equipped');
    });

    it('rejects out-of-range slot', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Bad slot',
        actions: [{ type: 'equipItem', slot: 15 }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('0-8');
    });
  });

  // ─── collectDrops ───────────────────────────────────────────────────

  describe('collectDrops (cheat mode)', () => {
    it('teleports items to bot via /tp', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Pick up items',
        actions: [{ type: 'collectDrops', radius: 10 }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].actionType).toBe('collectDrops');
      expect(ctx.connection.sendCommand).toHaveBeenCalledWith(
        expect.stringContaining('tp @e[type=item')
      );
    });

    it('uses default radius of 16', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      await dispatcher.dispatch({
        thought: 'Pick up items',
        actions: [{ type: 'collectDrops' }],
      });

      expect(ctx.connection.sendCommand).toHaveBeenCalledWith(
        expect.stringContaining('r=16')
      );
    });
  });

  describe('collectDrops (survival mode)', () => {
    it('reports no items when none nearby', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Pick up items',
        actions: [{ type: 'collectDrops' }],
      });

      expect(results[0].success).toBe(true);
      expect(results[0].message).toContain('No dropped items');
    });

    it('walks to nearby item entities', async () => {
      const ctx = makeCtx();
      ctx.worldState.bot.position = { x: 0, y: 65, z: 0 };
      // Add a dropped item nearby
      ctx.worldState.itemEntities.set(100n, {
        runtimeId: 100n,
        itemName: 'diamond',
        count: 1,
        position: { x: 3, y: 65, z: 0 },
        lastSeen: Date.now(),
      });

      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Pick up diamond',
        actions: [{ type: 'collectDrops' }],
      });

      expect(results[0].success).toBe(true);
      expect(results[0].message).toContain('1 item');
    });
  });

  // ─── craft ──────────────────────────────────────────────────────────

  describe('craft (cheat mode)', () => {
    it('gives crafted item via /give', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Craft planks',
        actions: [{ type: 'craft', item: 'oak_planks' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].actionType).toBe('craft');
      expect(ctx.connection.sendCommand).toHaveBeenCalledWith(
        expect.stringContaining('give @s oak_planks')
      );
    });

    it('gives correct count for known recipes', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      await dispatcher.dispatch({
        thought: 'Craft planks',
        actions: [{ type: 'craft', item: 'oak_planks', count: 1 }],
      });

      // oak_planks recipe yields 4 per craft
      expect(ctx.connection.sendCommand).toHaveBeenCalledWith(
        expect.stringContaining('4')
      );
    });
  });

  describe('craft (survival mode)', () => {
    it('fails for unknown recipe', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Craft something weird',
        actions: [{ type: 'craft', item: 'totally_fake_item' }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('Unknown recipe');
    });

    it('fails when missing materials', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Craft pickaxe without materials',
        actions: [{ type: 'craft', item: 'iron_pickaxe' }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('Missing materials');
    });

    it('requires crafting table for complex recipes', async () => {
      const ctx = makeCtx();
      // Add materials for iron pickaxe
      ctx.worldState.inventory.set(0, { slot: 0, name: 'iron_ingot', count: 10 });
      ctx.worldState.inventory.set(1, { slot: 1, name: 'stick', count: 10 });
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Craft iron pickaxe',
        actions: [{ type: 'craft', item: 'iron_pickaxe' }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('crafting table');
    });
  });

  // ─── openContainer / closeContainer ─────────────────────────────────

  describe('openContainer (cheat mode)', () => {
    it('teleports to container position', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Open chest',
        actions: [{ type: 'openContainer', x: 10, y: 65, z: 20 }],
      });

      expect(results[0].success).toBe(true);
      expect(ctx.connection.sendCommand).toHaveBeenCalledWith(
        expect.stringContaining('tp @s')
      );
    });
  });

  describe('openContainer (survival mode)', () => {
    it('fails when too far', async () => {
      const ctx = makeCtx();
      ctx.worldState.bot.position = { x: 0, y: 65, z: 0 };
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Open chest',
        actions: [{ type: 'openContainer', x: 100, y: 65, z: 100 }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('too far');
    });
  });

  describe('closeContainer', () => {
    it('succeeds when no container open', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Close',
        actions: [{ type: 'closeContainer' }],
      });

      expect(results[0].success).toBe(true);
      expect(results[0].message).toContain('No container');
    });
  });

  // ─── storeItem / retrieveItem ───────────────────────────────────────

  describe('storeItem (cheat mode)', () => {
    it('clears item from inventory', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Store diamonds',
        actions: [{ type: 'storeItem', item: 'diamond', count: 5 }],
      });

      expect(results[0].success).toBe(true);
      expect(ctx.connection.sendCommand).toHaveBeenCalledWith(
        expect.stringContaining('clear @s diamond')
      );
    });
  });

  describe('storeItem (survival mode)', () => {
    it('fails when no container open', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Store diamonds',
        actions: [{ type: 'storeItem', item: 'diamond' }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('No container');
    });
  });

  describe('retrieveItem (cheat mode)', () => {
    it('gives item via command', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Get diamonds',
        actions: [{ type: 'retrieveItem', item: 'diamond', count: 3 }],
      });

      expect(results[0].success).toBe(true);
      expect(ctx.connection.sendCommand).toHaveBeenCalledWith(
        expect.stringContaining('give @s diamond 3')
      );
    });
  });

  describe('retrieveItem (survival mode)', () => {
    it('fails when no container open', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Get diamonds',
        actions: [{ type: 'retrieveItem', item: 'diamond' }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('No container');
    });
  });

  // ─── Enhanced breakBlock (survival) ─────────────────────────────────

  describe('breakBlock (survival, enhanced)', () => {
    it('dispatches breakBlock with tool auto-selection', async () => {
      const ctx = makeCtx();
      ctx.worldState.bot.position = { x: 0, y: 65, z: 0 };
      ctx.worldState.inventory.set(0, { slot: 0, name: 'iron_pickaxe', count: 1 });
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Mine stone',
        actions: [{ type: 'breakBlock', x: 1, y: 64, z: 0 }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('breakBlock');
    });
  });

  // ─── Action chaining ───────────────────────────────────────────────

  describe('action chaining', () => {
    it('chains equip + break + collect in survival', async () => {
      const ctx = makeCtx();
      ctx.worldState.bot.position = { x: 0, y: 65, z: 0 };
      ctx.worldState.inventory.set(0, { slot: 0, name: 'iron_pickaxe', count: 1 });

      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Mine stone and collect drops',
        actions: [
          { type: 'equipItem', item: 'pickaxe' },
          { type: 'breakBlock', x: 1, y: 64, z: 0 },
          { type: 'collectDrops' },
        ],
      });

      expect(results).toHaveLength(3);
      expect(results[0].actionType).toBe('equipItem');
      expect(results[1].actionType).toBe('breakBlock');
      expect(results[2].actionType).toBe('collectDrops');
    });

    it('chains craft + equip in cheat mode', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Craft and equip',
        actions: [
          { type: 'craft', item: 'iron_pickaxe' },
          { type: 'equipItem', item: 'iron_pickaxe' },
        ],
      });

      expect(results).toHaveLength(2);
      expect(results[0].actionType).toBe('craft');
      expect(results[1].actionType).toBe('equipItem');
    });
  });
});
