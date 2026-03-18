import { describe, it, expect, vi } from 'vitest';
import { ActionDispatcher } from '../../src/skills/actionDispatcher';
import { SkillContext, ActionRequest } from '../../src/skills/types';
import { WorldState } from '../../src/bot/worldState';

// Mock connection
function mockConnection() {
  return {
    sendChat: vi.fn(),
    sendCommand: vi.fn(),
    getBotName: () => 'TestBot',
    getClient: () => null, // no real client
  } as any;
}

function makeCtx(): SkillContext {
  return {
    connection: mockConnection(),
    worldState: new WorldState(),
  };
}

describe('ActionDispatcher', () => {
  describe('cheats mode', () => {
    it('dispatches chat action', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const request: ActionRequest = {
        thought: 'Say hello',
        actions: [{ type: 'chat', message: 'Hello!' }],
      };

      const results = await dispatcher.dispatch(request);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].actionType).toBe('chat');
      expect(ctx.connection.sendChat).toHaveBeenCalledWith('Hello!');
    });

    it('dispatches navigateTo via sendCommand', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Go somewhere',
        actions: [{ type: 'navigateTo', x: 10, y: 65, z: 20 }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('navigateTo');
      expect(ctx.connection.sendCommand).toHaveBeenCalled();
    });

    it('dispatches giveItem via sendCommand', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Give diamond',
        actions: [{ type: 'giveItem', item: 'diamond', count: 5 }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(ctx.connection.sendCommand).toHaveBeenCalledWith(
        expect.stringContaining('give')
      );
    });

    it('dispatches multiple actions in order', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Chat and give',
        actions: [
          { type: 'chat', message: 'Here you go!' },
          { type: 'giveItem', item: 'diamond', count: 1 },
        ],
      });

      expect(results).toHaveLength(2);
      expect(results[0].actionType).toBe('chat');
      expect(results[1].actionType).toBe('giveItem');
    });

    it('handles unknown action types gracefully', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'Do something weird',
        actions: [{ type: 'flyToMoon' } as any],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('Unknown');
    });

    it('catches action errors without crashing', async () => {
      const ctx = makeCtx();
      // Make sendCommand throw
      ctx.connection.sendCommand = vi.fn(() => { throw new Error('network fail'); });
      const dispatcher = new ActionDispatcher(ctx, true);

      const results = await dispatcher.dispatch({
        thought: 'This will error',
        actions: [{ type: 'setTime', time: 'day' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('network fail');
    });
  });

  describe('survival mode', () => {
    it('dispatches chat (shared action)', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Say hi',
        actions: [{ type: 'chat', message: 'Hi!' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].actionType).toBe('chat');
    });

    it('dispatches wait (shared action)', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Wait a bit',
        actions: [{ type: 'wait', seconds: 1 }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].actionType).toBe('wait');
    });

    it('dispatches walkTo (survival action)', async () => {
      const ctx = makeCtx();
      ctx.worldState.bot.position = { x: 0, y: 65, z: 0 };
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Walk somewhere',
        actions: [{ type: 'walkTo', x: 2, y: 65, z: 2 }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('walkTo');
      // No client, so walk position updates happen internally
    });

    it('dispatches jump (survival action)', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Jump',
        actions: [{ type: 'jump' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('jump');
    });

    it('dispatches sneak (survival action)', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Sneak',
        actions: [{ type: 'sneak', enabled: true }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('sneak');
    });

    it('dispatches sprint (survival action)', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Sprint',
        actions: [{ type: 'sprint', enabled: true }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('sprint');
    });

    it('dispatches dropItem (survival action)', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Drop it',
        actions: [{ type: 'dropItem' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('dropItem');
    });

    it('returns unknown for cheat-only actions', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Try cheat',
        actions: [{ type: 'navigateTo', x: 0, y: 0, z: 0 }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('Unknown');
    });

    it('dispatches equipItem in survival', async () => {
      const ctx = makeCtx();
      // equipItem needs a client with queue()
      ctx.connection.getClient = () => ({ queue: vi.fn() }) as any;
      ctx.worldState.inventory.set(0, { slot: 0, name: 'iron_pickaxe', count: 1 });
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Equip',
        actions: [{ type: 'equipItem', slot: 0 }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].actionType).toBe('equipItem');
    });

    it('dispatches collectDrops in survival', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Collect',
        actions: [{ type: 'collectDrops' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('collectDrops');
    });

    it('dispatches craft in survival', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Craft',
        actions: [{ type: 'craft', item: 'oak_planks' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('craft');
    });

    it('dispatches closeContainer in survival', async () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, false);

      const results = await dispatcher.dispatch({
        thought: 'Close',
        actions: [{ type: 'closeContainer' }],
      });

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('closeContainer');
    });
  });

  describe('getStatus', () => {
    it('returns Idle by default', () => {
      const ctx = makeCtx();
      const dispatcher = new ActionDispatcher(ctx, true);
      expect(dispatcher.getStatus()).toBe('Idle');
    });
  });
});
