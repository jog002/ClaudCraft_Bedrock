import * as dotenv from 'dotenv';
import { loadConfig } from './config';
import { BotConnection, ChatEvent } from './bot/connection';
import { LLMClient } from './llm/client';
import { PromptBuilder } from './llm/promptBuilder';

dotenv.config();

// Rate limiting: minimum ms between LLM responses
const MIN_RESPONSE_INTERVAL = 3000;
let lastResponseTime = 0;
let pendingResponse = false;

async function main() {
  console.log('=== ClaudCraft Bedrock Bot ===\n');

  // Validate API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY not set in environment or .env file.');
    console.error('Create a .env file with: ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  // Load config
  const config = loadConfig();
  console.log(`Bot name: ${config.bot.name}`);
  console.log(`LLM model: ${config.llm.chatModel}`);
  console.log(`Connection: ${config.connection.type === 'realm' ? `Realm "${config.connection.realmName}"` : `${config.connection.host}:${config.connection.port}`}`);
  console.log(`Offline mode: ${config.connection.offline}\n`);

  // Initialize components
  const llm = new LLMClient(config.llm);
  const promptBuilder = new PromptBuilder(config.bot);
  const connection = new BotConnection(config);

  // Handle chat messages
  connection.on('chat', async (event: ChatEvent) => {
    const { username, message } = event;

    // Add to chat history regardless of whether we respond
    promptBuilder.addMessage(username, message);

    // Check if we should respond
    if (!promptBuilder.shouldRespond(username, message)) return;

    // Rate limiting
    const now = Date.now();
    if (pendingResponse || now - lastResponseTime < MIN_RESPONSE_INTERVAL) {
      return;
    }

    pendingResponse = true;
    try {
      const systemPrompt = promptBuilder.getSystemPrompt();
      const chatPrompt = promptBuilder.buildChatPrompt();

      console.log(`[LLM] Generating response to <${username}> ${message}`);
      const response = await llm.chat(systemPrompt, chatPrompt);

      if (response) {
        console.log(`[LLM] Response: ${response}`);
        connection.sendChat(response);

        // Add bot's own message to history
        promptBuilder.addMessage(config.bot.name, response);
      }

      lastResponseTime = Date.now();
    } catch (err: any) {
      console.error(`[LLM] Error generating response: ${err.message}`);
    } finally {
      pendingResponse = false;
    }
  });

  connection.on('spawn', () => {
    console.log(`[Bot] ${config.bot.name} is alive and listening for chat!`);
  });

  connection.on('error', (err: Error) => {
    console.error(`[Bot] Connection error: ${err.message}`);
  });

  connection.on('give_up', () => {
    console.error('[Bot] Could not maintain connection. Exiting.');
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Bot] Shutting down...');
    connection.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[Bot] Shutting down...');
    connection.disconnect();
    process.exit(0);
  });

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
