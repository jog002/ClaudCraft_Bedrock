import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryManager } from '../../src/memory/memoryManager';

const TEST_MEMORY_PATH = path.join(__dirname, '..', '..', 'test_memory.json');

describe('MemoryManager', () => {
  let mm: MemoryManager;

  beforeEach(() => {
    // Clean up any existing test file
    if (fs.existsSync(TEST_MEMORY_PATH)) {
      fs.unlinkSync(TEST_MEMORY_PATH);
    }
    mm = new MemoryManager(TEST_MEMORY_PATH);
  });

  afterEach(() => {
    mm.shutdown();
    if (fs.existsSync(TEST_MEMORY_PATH)) {
      fs.unlinkSync(TEST_MEMORY_PATH);
    }
  });

  describe('lifecycle', () => {
    it('loads with defaults when no file exists', () => {
      mm.load();
      expect(mm.getAllMemories()).toEqual([]);
      expect(Object.keys(mm.getAllLocations())).toHaveLength(0);
    });

    it('saves and reloads data', () => {
      mm.load();
      mm.addMemory('test memory', 'observation');
      mm.saveLocation('home', { x: 10, y: 64, z: 20 }, 'my base');
      mm.save();

      const mm2 = new MemoryManager(TEST_MEMORY_PATH);
      mm2.load();
      expect(mm2.getAllMemories()).toHaveLength(1);
      expect(mm2.getAllMemories()[0].text).toBe('test memory');
      expect(mm2.getLocation('home')).toEqual({ x: 10, y: 64, z: 20, note: 'my base' });
      mm2.shutdown();
    });

    it('increments totalSessions on each load', () => {
      mm.load();
      mm.save();

      const mm2 = new MemoryManager(TEST_MEMORY_PATH);
      mm2.load();
      expect(mm2.getRawData().totalSessions).toBe(2);
      mm2.shutdown();
    });
  });

  describe('memories', () => {
    beforeEach(() => mm.load());

    it('adds and retrieves memories', () => {
      mm.addMemory('Found diamonds at y=11', 'observation');
      mm.addMemory('Never dig straight down', 'lesson');

      const recent = mm.getRecentMemories(10);
      expect(recent).toHaveLength(2);
      expect(recent[0].text).toBe('Found diamonds at y=11');
      expect(recent[1].category).toBe('lesson');
    });

    it('searches memories by keyword', () => {
      mm.addMemory('Found diamonds at y=11', 'observation');
      mm.addMemory('Built a house near the lake', 'event');
      mm.addMemory('Oscar likes diamonds', 'relationship');

      const results = mm.getRelevantMemories('diamonds');
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every(r => r.text.toLowerCase().includes('diamond'))).toBe(true);
    });

    it('prunes oldest observations when over cap', () => {
      for (let i = 0; i < 205; i++) {
        mm.addMemory(`observation ${i}`, 'observation');
      }
      expect(mm.getAllMemories().length).toBeLessThanOrEqual(200);
    });

    it('preserves lessons over observations when pruning', () => {
      mm.addMemory('important lesson', 'lesson');
      for (let i = 0; i < 205; i++) {
        mm.addMemory(`observation ${i}`, 'observation');
      }
      const all = mm.getAllMemories();
      expect(all.some(m => m.text === 'important lesson')).toBe(true);
    });
  });

  describe('locations', () => {
    beforeEach(() => mm.load());

    it('saves and retrieves locations', () => {
      mm.saveLocation('home', { x: 100, y: 65, z: 200 }, 'main base');
      expect(mm.getLocation('home')).toEqual({ x: 100, y: 65, z: 200, note: 'main base' });
    });

    it('is case-insensitive', () => {
      mm.saveLocation('Home', { x: 100, y: 65, z: 200 });
      expect(mm.getLocation('home')).not.toBeNull();
      expect(mm.getLocation('HOME')).not.toBeNull();
    });

    it('returns null for unknown locations', () => {
      expect(mm.getLocation('nonexistent')).toBeNull();
    });

    it('overwrites existing locations', () => {
      mm.saveLocation('base', { x: 10, y: 64, z: 10 });
      mm.saveLocation('base', { x: 20, y: 64, z: 20 }, 'new base');
      expect(mm.getLocation('base')).toEqual({ x: 20, y: 64, z: 20, note: 'new base' });
    });
  });

  describe('deaths', () => {
    beforeEach(() => mm.load());

    it('records deaths', () => {
      mm.recordDeath({ x: 50, y: 64, z: 80 }, 'overworld', 'killed by creeper');
      const deaths = mm.getRecentDeaths(5);
      expect(deaths).toHaveLength(1);
      expect(deaths[0].cause).toBe('killed by creeper');
    });

    it('auto-saves death location', () => {
      mm.recordDeath({ x: 50, y: 64, z: 80 }, 'overworld', 'killed by zombie');
      const loc = mm.getLocation('death_1');
      expect(loc).not.toBeNull();
      expect(loc!.x).toBe(50);
    });

    it('finds deaths near a position', () => {
      mm.recordDeath({ x: 10, y: 64, z: 10 }, 'overworld', 'lava');
      mm.recordDeath({ x: 200, y: 64, z: 200 }, 'overworld', 'fall');

      const nearby = mm.getDeathsNear({ x: 12, y: 64, z: 12 }, 10);
      expect(nearby).toHaveLength(1);
      expect(nearby[0].cause).toBe('lava');
    });
  });

  describe('players', () => {
    beforeEach(() => mm.load());

    it('adds player notes', () => {
      mm.addPlayerNote('Oscar', 'realm owner');
      mm.addPlayerNote('Oscar', 'likes building castles');

      const profile = mm.getPlayer('oscar');
      expect(profile).not.toBeNull();
      expect(profile!.notes).toHaveLength(2);
      expect(profile!.notes[0]).toBe('realm owner');
    });

    it('updates player profile', () => {
      mm.updatePlayer('Oscar', { trustLevel: 'owner' });
      const profile = mm.getPlayer('Oscar');
      expect(profile!.trustLevel).toBe('owner');
    });

    it('returns null for unknown players', () => {
      expect(mm.getPlayer('nobody')).toBeNull();
    });
  });

  describe('goals', () => {
    beforeEach(() => mm.load());

    it('pushes and retrieves active goal', () => {
      mm.pushGoal('Build a house');
      const goal = mm.getActiveGoal();
      expect(goal).not.toBeNull();
      expect(goal!.description).toBe('Build a house');
      expect(goal!.status).toBe('active');
    });

    it('pauses old goal when new one is pushed', () => {
      mm.pushGoal('Build a house');
      mm.pushGoal('Gather wood');

      const active = mm.getActiveGoal();
      expect(active!.description).toBe('Gather wood');

      const stack = mm.getGoalStack();
      expect(stack[0].status).toBe('paused');
      expect(stack[1].status).toBe('active');
    });

    it('resumes paused goal on completion', () => {
      mm.pushGoal('Build a house');
      mm.pushGoal('Gather wood');
      mm.completeGoal();

      const active = mm.getActiveGoal();
      expect(active!.description).toBe('Build a house');
      expect(active!.status).toBe('active');
    });

    it('returns null when no active goal', () => {
      expect(mm.getActiveGoal()).toBeNull();
    });
  });

  describe('skills', () => {
    beforeEach(() => mm.load());

    it('saves and retrieves skills', () => {
      mm.saveSkill('gather_wood', 'Chop 8 logs', 'walk to tree, mine log x8, collect drops');
      const skill = mm.getSkill('gather_wood');
      expect(skill).not.toBeNull();
      expect(skill!.description).toBe('Chop 8 logs');
      expect(skill!.steps).toBe('walk to tree, mine log x8, collect drops');
    });

    it('lists all skill names', () => {
      mm.saveSkill('gather_wood', 'desc', 'steps');
      mm.saveSkill('smelt_iron', 'desc', 'steps');
      expect(mm.getAllSkillNames()).toEqual(['gather_wood', 'smelt_iron']);
    });

    it('returns null for unknown skills', () => {
      expect(mm.getSkill('nonexistent')).toBeNull();
    });
  });

  describe('getMemorySummary', () => {
    beforeEach(() => mm.load());

    it('returns empty string when no data', () => {
      const summary = mm.getMemorySummary();
      expect(summary).toBe('');
    });

    it('includes memories, locations, and deaths', () => {
      mm.addMemory('Found iron at cave', 'observation');
      mm.saveLocation('cave', { x: 50, y: 30, z: 50 }, 'iron cave');
      mm.recordDeath({ x: 10, y: 64, z: 10 }, 'overworld', 'creeper');

      const summary = mm.getMemorySummary({ x: 0, y: 64, z: 0 });
      expect(summary).toContain('MEMORIES:');
      expect(summary).toContain('Found iron at cave');
      expect(summary).toContain('KNOWN LOCATIONS:');
      expect(summary).toContain('cave');
      expect(summary).toContain('RECENT DEATHS:');
      expect(summary).toContain('creeper');
    });

    it('includes player notes for nearby players', () => {
      mm.addPlayerNote('Oscar', 'realm owner');
      const summary = mm.getMemorySummary(undefined, undefined, ['Oscar']);
      expect(summary).toContain('PLAYER NOTES:');
      expect(summary).toContain('realm owner');
    });

    it('includes skill names', () => {
      mm.saveSkill('gather_wood', 'Chop logs', 'steps');
      const summary = mm.getMemorySummary();
      expect(summary).toContain('SAVED SKILLS:');
      expect(summary).toContain('gather_wood');
    });

    it('truncates to ~1500 chars', () => {
      for (let i = 0; i < 100; i++) {
        mm.addMemory(`Long memory entry number ${i} with lots of extra text to fill space`, 'observation');
      }
      const summary = mm.getMemorySummary();
      expect(summary.length).toBeLessThanOrEqual(1500);
    });
  });
});
