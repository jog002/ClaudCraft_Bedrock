import { describe, it, expect } from 'vitest';
import { getActionToolDefinition } from '../../src/skills/types';

describe('Action Tool Definition', () => {
  describe('cheats mode', () => {
    const def = getActionToolDefinition(true);

    it('has correct tool name', () => {
      expect(def.name).toBe('take_actions');
    });

    it('includes cheat action types', () => {
      const types = def.input_schema.properties.actions.items.properties.type.enum;
      expect(types).toContain('navigateTo');
      expect(types).toContain('navigateToPlayer');
      expect(types).toContain('giveItem');
      expect(types).toContain('fillBlocks');
      expect(types).toContain('summon');
      expect(types).toContain('setTime');
      expect(types).toContain('weather');
      expect(types).toContain('effect');
      expect(types).toContain('enchant');
      expect(types).toContain('clearInventory');
      expect(types).toContain('teleportEntity');
      expect(types).toContain('gamemode');
      expect(types).toContain('command');
    });

    it('does not include survival-only types', () => {
      const types = def.input_schema.properties.actions.items.properties.type.enum;
      expect(types).not.toContain('walkTo');
      expect(types).not.toContain('walkToPlayer');
      expect(types).not.toContain('jump');
      expect(types).not.toContain('sneak');
      expect(types).not.toContain('sprint');
      expect(types).not.toContain('dropItem');
    });

    it('includes cheat-specific properties', () => {
      const props = def.input_schema.properties.actions.items.properties;
      expect(props).toHaveProperty('command');
      expect(props).toHaveProperty('item');
      expect(props).toHaveProperty('target');
      expect(props).toHaveProperty('x1');
      expect(props).toHaveProperty('enchantment');
    });
  });

  describe('survival mode', () => {
    const def = getActionToolDefinition(false);

    it('includes survival action types', () => {
      const types = def.input_schema.properties.actions.items.properties.type.enum;
      expect(types).toContain('chat');
      expect(types).toContain('walkTo');
      expect(types).toContain('walkToPlayer');
      expect(types).toContain('followPlayer');
      expect(types).toContain('stopFollowing');
      expect(types).toContain('lookAtPlayer');
      expect(types).toContain('attack');
      expect(types).toContain('wait');
      expect(types).toContain('placeBlock');
      expect(types).toContain('breakBlock');
      expect(types).toContain('jump');
      expect(types).toContain('sneak');
      expect(types).toContain('sprint');
      expect(types).toContain('dropItem');
    });

    it('does not include cheat-only types', () => {
      const types = def.input_schema.properties.actions.items.properties.type.enum;
      expect(types).not.toContain('navigateTo');
      expect(types).not.toContain('giveItem');
      expect(types).not.toContain('fillBlocks');
      expect(types).not.toContain('summon');
      expect(types).not.toContain('command');
      expect(types).not.toContain('teleportEntity');
      expect(types).not.toContain('gamemode');
    });

    it('does not include cheat-specific properties', () => {
      const props = def.input_schema.properties.actions.items.properties;
      expect(props).not.toHaveProperty('command');
      expect(props).not.toHaveProperty('x1');
      expect(props).not.toHaveProperty('enchantment');
    });
  });

  describe('shared structure', () => {
    it('both modes require thought and actions', () => {
      for (const cheats of [true, false]) {
        const def = getActionToolDefinition(cheats);
        expect(def.input_schema.required).toContain('thought');
        expect(def.input_schema.required).toContain('actions');
      }
    });

    it('both modes have goal fields', () => {
      for (const cheats of [true, false]) {
        const def = getActionToolDefinition(cheats);
        expect(def.input_schema.properties).toHaveProperty('goal');
        expect(def.input_schema.properties).toHaveProperty('goalComplete');
      }
    });

    it('both modes share common properties', () => {
      for (const cheats of [true, false]) {
        const def = getActionToolDefinition(cheats);
        const props = def.input_schema.properties.actions.items.properties;
        expect(props).toHaveProperty('message');
        expect(props).toHaveProperty('x');
        expect(props).toHaveProperty('y');
        expect(props).toHaveProperty('z');
        expect(props).toHaveProperty('playerName');
        expect(props).toHaveProperty('entityName');
        expect(props).toHaveProperty('duration');
      }
    });
  });
});
