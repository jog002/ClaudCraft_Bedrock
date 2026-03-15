import { BotConfig } from '../config';

export interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;
}

const MAX_CHAT_HISTORY = 20;

export class PromptBuilder {
  private chatHistory: ChatMessage[] = [];
  private botConfig: BotConfig;

  constructor(botConfig: BotConfig) {
    this.botConfig = botConfig;
  }

  getSystemPrompt(): string {
    return `You are ${this.botConfig.name}, a ${this.botConfig.persona}.
You are playing Minecraft Bedrock Edition on a server with other players.
Respond naturally to players in chat. Keep responses to 1-2 short sentences.
Stay in character. Never break the fourth wall or mention being an AI or a bot.
Be helpful, fun, and occasionally make Minecraft-related jokes or observations.
If someone asks you to do something you can't do yet, make a lighthearted excuse.
Your chat messages will appear in-game, so keep them concise (under 200 characters ideally).`;
  }

  addMessage(username: string, message: string): void {
    this.chatHistory.push({
      username,
      message,
      timestamp: Date.now(),
    });

    // Keep history bounded
    if (this.chatHistory.length > MAX_CHAT_HISTORY) {
      this.chatHistory = this.chatHistory.slice(-MAX_CHAT_HISTORY);
    }
  }

  buildChatPrompt(): string {
    if (this.chatHistory.length === 0) {
      return 'No recent chat messages.';
    }

    const lines = this.chatHistory.map(
      (msg) => `<${msg.username}> ${msg.message}`
    );

    return `RECENT CHAT:\n${lines.join('\n')}\n\nRespond as ${this.botConfig.name}:`;
  }

  shouldRespond(username: string, message: string): boolean {
    // Don't respond to own messages
    if (username === this.botConfig.name) return false;

    // Always respond to direct mentions
    if (message.toLowerCase().includes(this.botConfig.name.toLowerCase())) {
      return true;
    }

    // Respond to questions directed at the chat
    if (message.endsWith('?')) return true;

    // Respond to greetings
    const greetings = ['hello', 'hey', 'hi', 'yo', 'sup', 'howdy'];
    const lowerMsg = message.toLowerCase().trim();
    if (greetings.some((g) => lowerMsg.startsWith(g))) return true;

    // Random chance to respond to other messages (30%)
    return Math.random() < 0.3;
  }
}
