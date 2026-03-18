import { describe, it, expect } from 'vitest';
import { DataLookup } from '../../src/bot/dataLookup';

describe('DataLookup', () => {
  const dl = new DataLookup();

  describe('getBlockHardness', () => {
    it('returns 0 for instant-break blocks', () => {
      expect(dl.getBlockHardness('grass')).toBe(0);
      expect(dl.getBlockHardness('torch')).toBe(0);
    });

    it('returns correct hardness for common blocks', () => {
      expect(dl.getBlockHardness('dirt')).toBe(0.5);
      expect(dl.getBlockHardness('stone')).toBe(1.5);
      expect(dl.getBlockHardness('oak_log')).toBe(2);
      expect(dl.getBlockHardness('diamond_ore')).toBe(3);
      expect(dl.getBlockHardness('obsidian')).toBe(50);
    });

    it('returns -1 for unbreakable blocks', () => {
      expect(dl.getBlockHardness('bedrock')).toBe(-1);
    });

    it('strips minecraft: prefix', () => {
      expect(dl.getBlockHardness('minecraft:stone')).toBe(1.5);
    });

    it('returns default for unknown blocks', () => {
      expect(dl.getBlockHardness('totally_unknown_block')).toBe(1.5);
    });
  });

  describe('getEffectiveTool', () => {
    it('returns pickaxe for stone-type blocks', () => {
      expect(dl.getEffectiveTool('stone')).toBe('pickaxe');
      expect(dl.getEffectiveTool('cobblestone')).toBe('pickaxe');
      expect(dl.getEffectiveTool('iron_ore')).toBe('pickaxe');
    });

    it('returns axe for wood-type blocks', () => {
      expect(dl.getEffectiveTool('oak_log')).toBe('axe');
      expect(dl.getEffectiveTool('crafting_table')).toBe('axe');
    });

    it('returns shovel for dirt-type blocks', () => {
      expect(dl.getEffectiveTool('dirt')).toBe('shovel');
      expect(dl.getEffectiveTool('sand')).toBe('shovel');
      expect(dl.getEffectiveTool('gravel')).toBe('shovel');
    });

    it('returns null for blocks with no preferred tool', () => {
      expect(dl.getEffectiveTool('totally_unknown')).toBeNull();
    });
  });

  describe('getMiningTimeMs', () => {
    it('returns 50ms for instant-break blocks', () => {
      expect(dl.getMiningTimeMs('grass')).toBe(50);
    });

    it('returns -1 for unbreakable blocks', () => {
      expect(dl.getMiningTimeMs('bedrock')).toBe(-1);
    });

    it('returns longer time with bare hand', () => {
      const bareHand = dl.getMiningTimeMs('stone');
      expect(bareHand).toBeGreaterThan(1000);
    });

    it('returns shorter time with correct tool', () => {
      const bareHand = dl.getMiningTimeMs('stone');
      const withPickaxe = dl.getMiningTimeMs('stone', 'iron_pickaxe');
      expect(withPickaxe).toBeLessThan(bareHand);
    });

    it('returns faster time with higher tier tool', () => {
      const stonePickaxe = dl.getMiningTimeMs('stone', 'stone_pickaxe');
      const diamondPickaxe = dl.getMiningTimeMs('stone', 'diamond_pickaxe');
      expect(diamondPickaxe).toBeLessThan(stonePickaxe);
    });
  });

  describe('parseToolName', () => {
    it('parses standard tool names', () => {
      const info = dl.parseToolName('iron_pickaxe');
      expect(info).toBeDefined();
      expect(info!.tier).toBe('iron');
      expect(info!.type).toBe('pickaxe');
    });

    it('parses diamond tools', () => {
      const info = dl.parseToolName('diamond_sword');
      expect(info).toBeDefined();
      expect(info!.tier).toBe('diamond');
      expect(info!.type).toBe('sword');
    });

    it('returns null for non-tool items', () => {
      expect(dl.parseToolName('diamond')).toBeNull();
      expect(dl.parseToolName('cobblestone')).toBeNull();
    });

    it('strips minecraft: prefix', () => {
      const info = dl.parseToolName('minecraft:iron_pickaxe');
      expect(info).toBeDefined();
      expect(info!.tier).toBe('iron');
    });
  });

  describe('getBestToolForBlock', () => {
    it('selects the best tool for stone from hotbar', () => {
      const items = [
        { name: 'iron_pickaxe', slot: 0 },
        { name: 'stone_pickaxe', slot: 1 },
        { name: 'wooden_axe', slot: 2 },
      ];
      const best = dl.getBestToolForBlock('stone', items);
      expect(best).toBeDefined();
      expect(best!.name).toBe('iron_pickaxe');
      expect(best!.slot).toBe(0);
    });

    it('selects axe for wood', () => {
      const items = [
        { name: 'iron_pickaxe', slot: 0 },
        { name: 'stone_axe', slot: 1 },
      ];
      const best = dl.getBestToolForBlock('oak_log', items);
      expect(best).toBeDefined();
      expect(best!.name).toBe('stone_axe');
    });

    it('returns null when no matching tool', () => {
      const items = [
        { name: 'iron_pickaxe', slot: 0 },
      ];
      const best = dl.getBestToolForBlock('dirt', items);
      expect(best).toBeNull();
    });

    it('returns null for empty hotbar', () => {
      expect(dl.getBestToolForBlock('stone', [])).toBeNull();
    });
  });

  describe('canHarvest', () => {
    it('allows diamond ore with iron pickaxe', () => {
      const result = dl.canHarvest('diamond_ore', 'iron_pickaxe');
      expect(result.canHarvest).toBe(true);
    });

    it('allows diamond ore with diamond pickaxe', () => {
      const result = dl.canHarvest('diamond_ore', 'diamond_pickaxe');
      expect(result.canHarvest).toBe(true);
    });

    it('rejects diamond ore with stone pickaxe', () => {
      const result = dl.canHarvest('diamond_ore', 'stone_pickaxe');
      expect(result.canHarvest).toBe(false);
      expect(result.reason).toContain('iron');
    });

    it('rejects diamond ore with bare hands', () => {
      const result = dl.canHarvest('diamond_ore');
      expect(result.canHarvest).toBe(false);
      expect(result.reason).toContain('bare hands');
    });

    it('rejects stone with bare hands', () => {
      const result = dl.canHarvest('stone');
      expect(result.canHarvest).toBe(false);
    });

    it('allows stone with wooden pickaxe', () => {
      const result = dl.canHarvest('stone', 'wooden_pickaxe');
      expect(result.canHarvest).toBe(true);
    });

    it('rejects obsidian with iron pickaxe', () => {
      const result = dl.canHarvest('obsidian', 'iron_pickaxe');
      expect(result.canHarvest).toBe(false);
      expect(result.reason).toContain('diamond');
    });

    it('allows obsidian with diamond pickaxe', () => {
      const result = dl.canHarvest('obsidian', 'diamond_pickaxe');
      expect(result.canHarvest).toBe(true);
    });

    it('rejects diamond ore with iron axe (wrong tool type)', () => {
      const result = dl.canHarvest('diamond_ore', 'iron_axe');
      expect(result.canHarvest).toBe(false);
      expect(result.reason).toContain('pickaxe');
    });

    it('allows dirt with bare hands (no requirement)', () => {
      const result = dl.canHarvest('dirt');
      expect(result.canHarvest).toBe(true);
    });

    it('treats golden pickaxe as wooden tier', () => {
      // Golden tools are fast but have same harvest level as wooden
      const result = dl.canHarvest('iron_ore', 'golden_pickaxe');
      expect(result.canHarvest).toBe(false); // iron ore needs stone+
    });

    it('allows iron ore with stone pickaxe', () => {
      const result = dl.canHarvest('iron_ore', 'stone_pickaxe');
      expect(result.canHarvest).toBe(true);
    });

    it('handles minecraft: prefix', () => {
      const result = dl.canHarvest('minecraft:diamond_ore', 'minecraft:iron_pickaxe');
      expect(result.canHarvest).toBe(true);
    });
  });
});
