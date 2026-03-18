import * as dotenv from 'dotenv';
import { loadConfig } from './config';
import { BotConnection, ChatEvent } from './bot/connection';
import { WorldState } from './bot/worldState';
import { LLMClient } from './llm/client';
import { PromptBuilder } from './llm/promptBuilder';
import { AgentLoop } from './llm/agentLoop';
import { MemoryManager } from './memory/memoryManager';

dotenv.config();

async function main() {
  console.log('=== ClaudCraft Bedrock Bot ===\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY not set in environment or .env file.');
    console.error('Create a .env file with: ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  const config = loadConfig();
  console.log(`Bot name: ${config.bot.name}`);
  console.log(`LLM model: ${config.llm.chatModel}`);
  const connDesc = config.connection.type === 'realm'
    ? `Realm "${config.connection.realmName}"`
    : config.connection.type === 'friend'
      ? `Friend's world${config.connection.friendGamertag ? ` (${config.connection.friendGamertag})` : ''}`
      : `${config.connection.host}:${config.connection.port}`;
  console.log(`Connection: ${connDesc}`);
  console.log(`Offline mode: ${config.connection.offline}`);
  console.log(`Cheats mode: ${config.connection.cheats ? 'enabled (command-based skills)' : 'disabled (packet-based skills)'}\n`);

  // Initialize components
  const memoryManager = new MemoryManager(config.bot.memoryPath);
  memoryManager.load();

  const llm = new LLMClient(config.llm, config.connection.cheats);
  const promptBuilder = new PromptBuilder(config.bot, config.connection.cheats);
  const connection = new BotConnection(config);
  const worldState = new WorldState();
  const agentLoop = new AgentLoop(connection, worldState, llm, promptBuilder, config, memoryManager);

  // Register world state listeners early (before spawn) to catch add_entity packets
  connection.on('join', () => {
    const client = connection.getClient();
    if (client) {
      worldState.registerListeners(client);
      console.log('[Bot] World awareness active.');
    }
  });

  // Handle chat messages via agent loop
  connection.on('chat', (event: ChatEvent) => {
    agentLoop.onChatEvent(event);
  });

  connection.on('spawn', () => {
    console.log(`[Bot] ${config.bot.name} is alive and listening!`);
    agentLoop.start();
  });

  connection.on('error', (err: Error) => {
    console.error(`[Bot] Connection error: ${err.message}`);
  });

  connection.on('give_up', () => {
    console.error('[Bot] Could not maintain connection. Exiting.');
    agentLoop.stop();
    worldState.cleanup();
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Bot] Shutting down...');
    agentLoop.stop();
    memoryManager.shutdown();
    worldState.cleanup();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Connect!
  try {
    await connection.connect();
  } catch (err: any) {
    console.error(`[Bot] Failed to connect: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
