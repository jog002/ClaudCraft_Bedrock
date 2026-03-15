import * as fs from 'fs';
import * as path from 'path';

export interface BotConfig {
  name: string;
  persona: string;
  authCachePath: string;
  microsoftEmail: string;
}

export interface ConnectionConfig {
  type: 'realm' | 'server';
  realmName: string;
  host: string;
  port: number;
  offline: boolean;
}

export interface LLMConfig {
  chatModel: string;
  reasoningModel: string;
  maxTokens: number;
  decisionIntervalMs: number;
}

export interface Config {
  bot: BotConfig;
  connection: ConnectionConfig;
  llm: LLMConfig;
}

const DEFAULT_CONFIG: Config = {
  bot: {
    name: 'Andy',
    persona: 'friendly and curious Minecraft bot who loves exploring and helping out',
    authCachePath: './auth_cache',
    microsoftEmail: '',
  },
  connection: {
    type: 'server',
    realmName: '',
    host: 'localhost',
    port: 19132,
    offline: true,
  },
  llm: {
    chatModel: 'claude-haiku-4-5-20251001',
    reasoningModel: 'claude-sonnet-4-6',
    maxTokens: 256,
    decisionIntervalMs: 5000,
  },
};

export function loadConfig(configPath?: string): Config {
  const resolvedPath = configPath || path.join(process.cwd(), 'config.json');

  if (!fs.existsSync(resolvedPath)) {
    console.log(`No config.json found at ${resolvedPath}, using defaults.`);
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const userConfig = JSON.parse(raw);

  // Deep merge user config over defaults
  return {
    bot: { ...DEFAULT_CONFIG.bot, ...userConfig.bot },
    connection: { ...DEFAULT_CONFIG.connection, ...userConfig.connection },
    llm: { ...DEFAULT_CONFIG.llm, ...userConfig.llm },
  };
}
