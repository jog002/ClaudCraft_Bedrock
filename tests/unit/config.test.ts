import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config';
import * as path from 'path';

describe('Config', () => {
  it('loads default config when no file exists', () => {
    const config = loadConfig('/nonexistent/config.json');
    expect(config.bot.name).toBe('Andy');
    expect(config.connection.type).toBe('server');
    expect(config.connection.cheats).toBe(true);
    expect(config.llm.chatModel).toContain('claude');
  });

  it('loads config.json and merges with defaults', () => {
    const config = loadConfig(path.join(process.cwd(), 'config.json'));
    expect(config.bot.name).toBe('ClaudeCraft');
    expect(config.connection.host).toBe('127.0.0.1');
    expect(config.connection.port).toBe(19132);
    expect(config.connection.offline).toBe(true);
    expect(typeof config.connection.cheats).toBe('boolean');
  });

  it('has all required LLM config fields', () => {
    const config = loadConfig();
    expect(config.llm.chatModel).toBeTruthy();
    expect(config.llm.reasoningModel).toBeTruthy();
    expect(config.llm.maxTokens).toBeGreaterThan(0);
    expect(config.llm.decisionIntervalMs).toBeGreaterThan(0);
  });
});
