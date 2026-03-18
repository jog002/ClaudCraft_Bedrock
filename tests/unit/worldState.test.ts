import { describe, it, expect, beforeEach } from 'vitest';
import { WorldState } from '../../src/bot/worldState';

describe('WorldState', () => {
  let ws: WorldState;

  beforeEach(() => {
    ws = new WorldState();
  });

  describe('initial state', () => {
    it('has default bot position at origin', () => {
      expect(ws.bot.position).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('has default dimension and gamemode', () => {
      expect(ws.bot.dimension).toBe('overworld');
      expect(ws.bot.gamemode).toBe('survival');
    });

    it('has full health and hunger', () => {
      expect(ws.attributes.health).toBe(20);
      expect(ws.attributes.hunger).toBe(20);
    });

    it('has empty players and entities', () => {
      expect(ws.players.size).toBe(0);
      expect(ws.entities.size).toBe(0);
    });

    it('has empty inventory', () => {
      expect(ws.inventory.size).toBe(0);
    });
  });

  describe('getPlayerByName', () => {
    it('returns undefined when no players', () => {
      expect(ws.getPlayerByName('Steve')).toBeUndefined();
    });

    it('finds player case-insensitively', () => {
      ws.players.set(1n, {
        username: 'TestPlayer',
        runtimeId: 1n,
        uniqueId: 1n,
        position: { x: 10, y: 65, z: 20 },
        yaw: 0,
        lastSeen: Date.now(),
      });

      expect(ws.getPlayerByName('testplayer')).toBeDefined();
      expect(ws.getPlayerByName('TESTPLAYER')).toBeDefined();
      expect(ws.getPlayerByName('TestPlayer')).toBeDefined();
      expect(ws.getPlayerByName('OtherPlayer')).toBeUndefined();
    });
  });

  describe('resolvePlayerName', () => {
    it('resolves generic Player_N names from chat', () => {
      ws.players.set(1n, {
        username: 'Player_1',
        runtimeId: 1n,
        uniqueId: 1n,
        position: { x: 10, y: 65, z: 20 },
        yaw: 0,
        lastSeen: Date.now(),
      });

      ws.resolvePlayerName('Steve');
      expect(ws.getPlayerByName('Steve')).toBeDefined();
      expect(ws.getPlayerByName('Player_1')).toBeUndefined();
    });
  });

  describe('getBotRuntimeId', () => {
    it('returns 0n by default', () => {
      expect(ws.getBotRuntimeId()).toBe(0n);
    });
  });

  describe('getWorldContext', () => {
    it('includes position', () => {
      ws.bot.position = { x: 100, y: 65, z: -200 };
      const ctx = ws.getWorldContext();
      expect(ctx).toContain('POSITION:');
      expect(ctx).toContain('100');
      expect(ctx).toContain('65');
      expect(ctx).toContain('-200');
    });

    it('includes dimension and gamemode', () => {
      ws.bot.dimension = 'nether';
      ws.bot.gamemode = 'creative';
      const ctx = ws.getWorldContext();
      expect(ctx).toContain('nether');
      expect(ctx).toContain('creative');
    });

    it('includes health/hunger in survival', () => {
      ws.bot.gamemode = 'survival';
      ws.attributes.health = 15;
      ws.attributes.hunger = 18;
      const ctx = ws.getWorldContext();
      expect(ctx).toContain('HEALTH: 15/20');
      expect(ctx).toContain('HUNGER: 18/20');
    });

    it('omits health/hunger in creative', () => {
      ws.bot.gamemode = 'creative';
      const ctx = ws.getWorldContext();
      expect(ctx).not.toContain('HEALTH:');
    });

    it('includes nearby players', () => {
      ws.bot.position = { x: 0, y: 65, z: 0 };
      ws.players.set(1n, {
        username: 'Steve',
        runtimeId: 1n,
        uniqueId: 1n,
        position: { x: 5, y: 65, z: 0 },
        yaw: 0,
        lastSeen: Date.now(),
      });

      const ctx = ws.getWorldContext();
      expect(ctx).toContain('NEARBY PLAYERS:');
      expect(ctx).toContain('Steve');
    });

    it('includes nearby entities', () => {
      ws.bot.position = { x: 0, y: 65, z: 0 };
      ws.entities.set(100n, {
        entityType: 'minecraft:zombie',
        displayName: 'Zombie',
        category: 'hostile',
        runtimeId: 100n,
        uniqueId: 100n,
        position: { x: 10, y: 65, z: 0 },
        lastSeen: Date.now(),
      });

      const ctx = ws.getWorldContext();
      expect(ctx).toContain('NEARBY ENTITIES:');
      expect(ctx).toContain('Zombie');
      expect(ctx).toContain('hostile');
    });

    it('includes inventory items', () => {
      ws.inventory.set(0, { slot: 0, name: 'diamond_sword', count: 1 });
      ws.inventory.set(1, { slot: 1, name: 'stone', count: 64 });

      const ctx = ws.getWorldContext();
      expect(ctx).toContain('INVENTORY:');
      expect(ctx).toContain('diamond_sword');
      expect(ctx).toContain('stone x64');
    });

    it('includes time of day', () => {
      ws.worldTime = 6000;
      const ctx = ws.getWorldContext();
      expect(ctx).toContain('TIME:');
    });
  });

  describe('item entity tracking', () => {
    it('starts with empty item entities', () => {
      expect(ws.itemEntities.size).toBe(0);
    });

    it('tracks nearby item entities', () => {
      ws.bot.position = { x: 0, y: 65, z: 0 };
      ws.itemEntities.set(100n, {
        runtimeId: 100n,
        itemName: 'diamond',
        count: 3,
        position: { x: 5, y: 65, z: 0 },
        lastSeen: Date.now(),
      });

      const nearby = ws.getNearbyItemEntities(16);
      expect(nearby).toHaveLength(1);
      expect(nearby[0].itemName).toBe('diamond');
      expect(nearby[0].count).toBe(3);
    });

    it('filters by radius', () => {
      ws.bot.position = { x: 0, y: 65, z: 0 };
      ws.itemEntities.set(101n, {
        runtimeId: 101n,
        itemName: 'stone',
        count: 1,
        position: { x: 50, y: 65, z: 0 },
        lastSeen: Date.now(),
      });

      expect(ws.getNearbyItemEntities(10)).toHaveLength(0);
      expect(ws.getNearbyItemEntities(100)).toHaveLength(1);
    });

    it('includes dropped items in world context', () => {
      ws.bot.position = { x: 0, y: 65, z: 0 };
      ws.itemEntities.set(102n, {
        runtimeId: 102n,
        itemName: 'gold_ingot',
        count: 5,
        position: { x: 3, y: 65, z: 0 },
        lastSeen: Date.now(),
      });

      const ctx = ws.getWorldContext();
      expect(ctx).toContain('DROPPED ITEMS NEARBY:');
      expect(ctx).toContain('gold_ingot');
    });
  });

  describe('hotbar management', () => {
    it('starts with held slot 0', () => {
      expect(ws.heldSlot).toBe(0);
    });

    it('getHeldItem returns item in held slot', () => {
      ws.inventory.set(0, { slot: 0, name: 'diamond_sword', count: 1 });
      expect(ws.getHeldItem()?.name).toBe('diamond_sword');
    });

    it('getHotbarItem returns correct slot', () => {
      ws.inventory.set(3, { slot: 3, name: 'iron_pickaxe', count: 1 });
      expect(ws.getHotbarItem(3)?.name).toBe('iron_pickaxe');
      expect(ws.getHotbarItem(4)).toBeUndefined();
    });

    it('findHotbarItem searches by name (case-insensitive)', () => {
      ws.inventory.set(1, { slot: 1, name: 'Stone Pickaxe', count: 1 });
      const found = ws.findHotbarItem('pickaxe');
      expect(found).toBeDefined();
      expect(found!.slot).toBe(1);
    });

    it('findHotbarItem returns undefined when not in hotbar', () => {
      ws.inventory.set(20, { slot: 20, name: 'iron_pickaxe', count: 1 });
      expect(ws.findHotbarItem('iron_pickaxe')).toBeUndefined();
    });

    it('findInventoryItem searches all slots', () => {
      ws.inventory.set(20, { slot: 20, name: 'diamond', count: 5 });
      const found = ws.findInventoryItem('diamond');
      expect(found).toBeDefined();
      expect(found!.slot).toBe(20);
    });

    it('includes hotbar info in world context', () => {
      ws.inventory.set(0, { slot: 0, name: 'diamond_sword', count: 1 });
      ws.inventory.set(1, { slot: 1, name: 'stone', count: 64 });
      const ctx = ws.getWorldContext();
      expect(ctx).toContain('HOTBAR:');
      expect(ctx).toContain('[0] diamond_sword');
      expect(ctx).toContain('[1] stone');
    });

    it('includes held item in world context', () => {
      ws.inventory.set(0, { slot: 0, name: 'iron_pickaxe', count: 1 });
      ws.heldSlot = 0;
      const ctx = ws.getWorldContext();
      expect(ctx).toContain('HELD ITEM: iron_pickaxe');
    });
  });

  describe('container state', () => {
    it('starts with no open container', () => {
      expect(ws.openContainer).toBeNull();
    });

    it('includes open container in world context', () => {
      ws.openContainer = {
        windowId: 1,
        windowType: 'chest',
        position: { x: 10, y: 65, z: 20 },
        slots: new Map(),
      };
      ws.openContainer.slots.set(0, { slot: 0, name: 'iron_ingot', count: 32 });

      const ctx = ws.getWorldContext();
      expect(ctx).toContain('OPEN CONTAINER: chest');
      expect(ctx).toContain('iron_ingot');
    });
  });

  describe('cleanup', () => {
    it('clears prune timer without error', () => {
      expect(() => ws.cleanup()).not.toThrow();
    });
  });
});
