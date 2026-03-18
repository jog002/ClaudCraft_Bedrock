import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../src/llm/promptBuilder';

const botConfig = {
  name: 'TestBot',
  persona: 'a helpful Minecraft bot',
  authCachePath: './auth_cache',
  microsoftEmail: '',
};

describe('PromptBuilder', () => {
  describe('cheats mode', () => {
    const pb = new PromptBuilder(botConfig, true);

    it('includes cheat actions in system prompt', () => {
      const prompt = pb.getSystemPrompt();
      expect(prompt).toContain('navigateTo');
      expect(prompt).toContain('giveItem');
      expect(prompt).toContain('fillBlocks');
      expect(prompt).toContain('summon');
      expect(prompt).toContain('setTime');
      expect(prompt).toContain('weather');
      expect(prompt).toContain('effect');
      expect(prompt).toContain('enchant');
      expect(prompt).toContain('teleportEntity');
      expect(prompt).toContain('gamemode');
      expect(prompt).toContain('command');
    });

    it('does NOT include survival-only actions', () => {
      const prompt = pb.getSystemPrompt();
      expect(prompt).not.toContain('walkTo:');
      expect(prompt).not.toContain('walkToPlayer:');
      expect(prompt).not.toContain('jump:');
      expect(prompt).not.toContain('sneak:');
      expect(prompt).not.toContain('sprint:');
      expect(prompt).not.toContain('dropItem:');
    });

    it('does not include survival guidelines', () => {
      const prompt = pb.getSystemPrompt();
      expect(prompt).not.toContain('survival mode without cheats');
    });
  });

  describe('survival mode', () => {
    const pb = new PromptBuilder(botConfig, false);

    it('includes survival actions in system prompt', () => {
      const prompt = pb.getSystemPrompt();
      expect(prompt).toContain('walkTo');
      expect(prompt).toContain('walkToPlayer');
      expect(prompt).toContain('followPlayer');
      expect(prompt).toContain('attack');
      expect(prompt).toContain('placeBlock');
      expect(prompt).toContain('breakBlock');
      expect(prompt).toContain('jump');
      expect(prompt).toContain('sneak');
      expect(prompt).toContain('sprint');
      expect(prompt).toContain('dropItem');
    });

    it('does NOT include cheat-only actions', () => {
      const prompt = pb.getSystemPrompt();
      expect(prompt).not.toContain('navigateTo:');
      expect(prompt).not.toContain('giveItem:');
      expect(prompt).not.toContain('fillBlocks:');
      expect(prompt).not.toContain('summon:');
      expect(prompt).not.toContain('teleportEntity:');
      expect(prompt).not.toContain('command:');
    });

    it('includes survival guidelines', () => {
      const prompt = pb.getSystemPrompt();
      expect(prompt).toContain('survival mode without cheats');
      expect(prompt).toContain('hotbar');
    });
  });

  describe('shared behavior', () => {
    it('always includes chat and lookAtPlayer', () => {
      const cheatsPrompt = new PromptBuilder(botConfig, true).getSystemPrompt();
      const survivalPrompt = new PromptBuilder(botConfig, false).getSystemPrompt();

      for (const prompt of [cheatsPrompt, survivalPrompt]) {
        expect(prompt).toContain('chat:');
        expect(prompt).toContain('lookAtPlayer:');
        expect(prompt).toContain('wait:');
      }
    });

    it('includes bot name and persona', () => {
      const pb = new PromptBuilder(botConfig, true);
      const prompt = pb.getSystemPrompt();
      expect(prompt).toContain('TestBot');
      expect(prompt).toContain('helpful Minecraft bot');
    });
  });

  describe('chat history', () => {
    it('adds and retrieves messages', () => {
      const pb = new PromptBuilder(botConfig, true);
      pb.addMessage('Player1', 'hello');
      pb.addMessage('TestBot', 'hi there');

      const prompt = pb.buildAgentPrompt('test world context');
      expect(prompt).toContain('<Player1> hello');
      expect(prompt).toContain('<TestBot> hi there');
    });

    it('limits history to 20 messages', () => {
      const pb = new PromptBuilder(botConfig, true);
      for (let i = 0; i < 25; i++) {
        pb.addMessage('Player', `msg ${i}`);
      }

      const prompt = pb.buildAgentPrompt('');
      // Should only have last 20
      expect(prompt).not.toContain('msg 0');
      expect(prompt).not.toContain('msg 4');
      expect(prompt).toContain('msg 5');
      expect(prompt).toContain('msg 24');
    });

    it('shouldRespond returns false for own messages', () => {
      const pb = new PromptBuilder(botConfig, true);
      expect(pb.shouldRespond('TestBot', 'anything')).toBe(false);
    });

    it('shouldRespond returns true when bot name is mentioned', () => {
      const pb = new PromptBuilder(botConfig, true);
      expect(pb.shouldRespond('Player1', 'hey TestBot come here')).toBe(true);
    });

    it('shouldRespond returns true for questions', () => {
      const pb = new PromptBuilder(botConfig, true);
      expect(pb.shouldRespond('Player1', 'what is that?')).toBe(true);
    });

    it('shouldRespond returns true for greetings', () => {
      const pb = new PromptBuilder(botConfig, true);
      expect(pb.shouldRespond('Player1', 'hello everyone')).toBe(true);
      expect(pb.shouldRespond('Player1', 'hey')).toBe(true);
      expect(pb.shouldRespond('Player1', 'yo')).toBe(true);
    });
  });

  describe('buildAgentPrompt', () => {
    it('includes world context', () => {
      const pb = new PromptBuilder(botConfig, true);
      const prompt = pb.buildAgentPrompt('POSITION: x=10, y=65, z=20');
      expect(prompt).toContain('WORLD STATE:');
      expect(prompt).toContain('POSITION: x=10, y=65, z=20');
    });

    it('includes action results', () => {
      const pb = new PromptBuilder(botConfig, true);
      const prompt = pb.buildAgentPrompt('', [
        { success: true, message: 'Teleported', actionType: 'navigateTo' },
        { success: false, message: 'Player not found', actionType: 'navigateToPlayer' },
      ]);
      expect(prompt).toContain('LAST ACTION RESULTS');
      expect(prompt).toContain('navigateTo: OK');
      expect(prompt).toContain('navigateToPlayer: FAILED');
    });

    it('includes current goal', () => {
      const pb = new PromptBuilder(botConfig, true);
      const prompt = pb.buildAgentPrompt('', undefined, {
        description: 'Build a house',
        startedAt: Date.now(),
      });
      expect(prompt).toContain('CURRENT GOAL: Build a house');
    });

    it('includes bot status', () => {
      const pb = new PromptBuilder(botConfig, true);
      const prompt = pb.buildAgentPrompt('', undefined, null, 'Currently following Player1');
      expect(prompt).toContain('STATUS: Currently following Player1');
    });

    it('skips status when idle', () => {
      const pb = new PromptBuilder(botConfig, true);
      const prompt = pb.buildAgentPrompt('', undefined, null, 'Idle');
      expect(prompt).not.toContain('STATUS:');
    });
  });
});
