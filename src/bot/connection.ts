import { EventEmitter } from 'events';
import { createClient, Client, ClientOptions } from 'bedrock-protocol';
import { Config } from '../config';
import { SessionFinder } from './sessionFinder';

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
  private connectedUsername = '';

  constructor(config: Config) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    // Clean up any existing connection to avoid server_id_conflict
    if (this.client) {
      try { this.client.close(); } catch {}
      this.client = null;
    }

    // Use bot name for offline/BDS connections, email only for authenticated connections
    const username = this.config.connection.offline
      ? this.config.bot.name
      : (this.config.bot.microsoftEmail || this.config.bot.name);
    this.connectedUsername = username;

    const options: ClientOptions = {
      host: process.env.BDS_HOST || this.config.connection.host,
      port: parseInt(process.env.BDS_PORT || '') || this.config.connection.port,
      username,
      offline: this.config.connection.offline,
      profilesFolder: this.config.bot.authCachePath,
      raknetBackend: process.env.RAKNET_BACKEND || 'jsp-raknet',
      skipPing: true, // Skip initial server ping — avoids "Ping timed out" on mobile/LAN
      connectTimeout: 15000,
      version: '1.26.0', // Force protocol version compatible with bedrock-protocol
      viewDistance: 4, // Low render distance — enough for local awareness, expanded by deepScan
    } as any;

    // Friend's world connection — discover via Xbox Live session
    if (this.config.connection.type === 'friend') {
      const sessionFinder = new SessionFinder(this.config);
      await sessionFinder.authenticate();

      const friendTag = this.config.connection.friendGamertag;
      console.log(`[Connection] Searching for ${friendTag ? `"${friendTag}"'s` : "any friend's"} Minecraft world...`);

      const worlds = await sessionFinder.findFriendWorlds(friendTag || undefined);

      if (worlds.length === 0) {
        throw new Error(
          friendTag
            ? `Could not find an active Minecraft session for "${friendTag}". Make sure they have a world open and the bot account is on their friends list.`
            : 'No friends are hosting a joinable Minecraft world right now.'
        );
      }

      const world = worlds[0];
      console.log(`[Connection] Found world: "${world.worldName}" hosted by ${world.hostGamertag} (${world.ip}:${world.port})`);
      console.log(`[Connection] Players: ${world.memberCount}/${world.maxMemberCount}, Version: ${world.version}`);

      options.host = world.ip;
      options.port = world.port;
      options.offline = false;
    }

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
      this.emit('join');
    });

    this.client.on('spawn', () => {
      console.log('[Connection] Bot spawned into the world!');
      this.emit('spawn');
    });

    this.client.on('text', (packet: TextPacket) => {
      // Filter out system messages and own messages
      const isOwnMessage = packet.source_name === this.getBotName() || packet.source_name === this.connectedUsername;
      if (packet.type === 'chat' && packet.source_name && !isOwnMessage) {
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
      // close event will also fire — let it handle reconnect
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
      // Include all fields required by the protocol schema to avoid bad_packet
      this.client.queue('text', {
        needs_translation: false,
        category: 'authored',
        type: 'chat',
        source_name: this.getBotName(),
        message: chunk,
        xuid: '',
        platform_chat_id: '',
        has_filtered_message: false,
      });
    }
  }

  sendCommand(command: string): void {
    if (!this.client) {
      console.error('[Connection] Cannot send command: not connected.');
      return;
    }

    const cmd = command.startsWith('/') ? command.slice(1) : command;

    this.client.queue('command_request', {
      command: cmd,
      origin: {
        type: 'player',
        uuid: '00000000-0000-0000-0000-000000000000',
        request_id: `cc-${Date.now()}`,
        player_entity_id: BigInt(0),
      },
      internal: false,
      version: '1',
    });
  }

  getBotName(): string {
    return this.config.bot.name;
  }

  getClient(): Client | null {
    return this.client;
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
