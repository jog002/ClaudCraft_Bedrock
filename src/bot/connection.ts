import { EventEmitter } from 'events';
import { createClient, Client, ClientOptions } from 'bedrock-protocol';
import { Config } from '../config';

interface TextPacket {
  type: string;
  needs_translation: boolean;
  source_name: string;
  message: string;
  xuid: string;
  platform_chat_id: string;
  filtered_message: string;
  parameters?: string[];
}

export interface ChatEvent {
  username: string;
  message: string;
}

export class BotConnection extends EventEmitter {
  private client: Client | null = null;
  private config: Config;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    const username = this.config.bot.microsoftEmail || this.config.bot.name;

    const options: ClientOptions = {
      host: this.config.connection.host,
      port: this.config.connection.port,
      username,
      offline: this.config.connection.offline,
      profilesFolder: this.config.bot.authCachePath,
      raknetBackend: 'jsp-raknet',
    };

    // Realm connection
    if (this.config.connection.type === 'realm' && this.config.connection.realmName) {
      const realmName = this.config.connection.realmName;
      options.realms = {
        pickRealm: (realms) => realms.find((r) => r.name === realmName)!,
      };
    }

    console.log(`[Connection] Connecting as "${username}"...`);
    if (this.config.connection.type === 'realm') {
      console.log(`[Connection] Target: Realm "${this.config.connection.realmName}"`);
    } else {
      console.log(`[Connection] Target: ${options.host}:${options.port}`);
    }

    this.client = createClient(options);

    this.client.on('join', () => {
      console.log('[Connection] Authenticated and joined server.');
      this.reconnectAttempts = 0;
    });

    this.client.on('spawn', () => {
      console.log('[Connection] Bot spawned into the world!');
      this.emit('spawn');
    });

    this.client.on('text', (packet: TextPacket) => {
      // Filter out system messages and own messages
      if (packet.type === 'chat' && packet.source_name && packet.source_name !== this.getBotName()) {
        this.emit('chat', {
          username: packet.source_name,
          message: packet.message,
        } as ChatEvent);
      }

      // Also log all text packets for debugging
      if (packet.source_name) {
        console.log(`[Chat] <${packet.source_name}> ${packet.message}`);
      } else if (packet.message) {
        console.log(`[System] ${packet.message}`);
      }
    });

    this.client.on('kick', (reason: any) => {
      console.log(`[Connection] Kicked from server:`, reason);
      this.emit('kicked', reason);
      this.handleDisconnect();
    });

    this.client.on('close', () => {
      console.log('[Connection] Connection closed.');
      this.emit('disconnected');
      this.handleDisconnect();
    });

    this.client.on('error', (err: Error) => {
      console.error('[Connection] Error:', err.message);
      this.emit('error', err);
    });
  }

  sendChat(message: string): void {
    if (!this.client) {
      console.error('[Connection] Cannot send chat: not connected.');
      return;
    }

    // Minecraft chat limit is ~256 chars; split if needed
    const chunks = this.splitMessage(message, 200);
    for (const chunk of chunks) {
      this.client.queue('text', {
        type: 'chat',
        needs_translation: false,
        source_name: this.getBotName(),
        xuid: '',
        platform_chat_id: '',
        filtered_message: '',
        message: chunk,
      });
    }
  }

  getBotName(): string {
    return this.config.bot.name;
  }

  disconnect(): void {
    this.maxReconnectAttempts = 0; // Prevent auto-reconnect
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  private splitMessage(message: string, maxLen: number): string[] {
    if (message.length <= maxLen) return [message];

    const chunks: string[] = [];
    let remaining = message;
    while (remaining.length > 0) {
      // Try to split at a space
      let splitIdx = maxLen;
      if (remaining.length > maxLen) {
        const lastSpace = remaining.lastIndexOf(' ', maxLen);
        if (lastSpace > maxLen * 0.5) splitIdx = lastSpace;
      }
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx).trimStart();
    }
    return chunks;
  }

  private handleDisconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[Connection] Max reconnect attempts reached. Giving up.');
      this.emit('give_up');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(
      `[Connection] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[Connection] Reconnect failed:', err.message);
        this.handleDisconnect();
      });
    }, delay);
  }
}
