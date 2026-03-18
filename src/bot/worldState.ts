import { Client } from 'bedrock-protocol';
import { DataLookup } from './dataLookup';
import { ChunkManager } from '../world/chunkManager';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface BotState {
  position: Vec3;
  yaw: number;
  pitch: number;
  dimension: string;
  gamemode: string;
}

interface TrackedPlayer {
  username: string;
  runtimeId: bigint;
  uniqueId: bigint;
  position: Vec3;
  yaw: number;
  lastSeen: number;
}

interface TrackedEntity {
  entityType: string;
  displayName: string;
  category: 'hostile' | 'passive' | 'neutral' | 'other';
  runtimeId: bigint;
  uniqueId: bigint;
  position: Vec3;
  lastSeen: number;
}

interface InventoryItem {
  slot: number;
  name: string;
  count: number;
  networkId?: number;
  /** Damage taken (0 = full durability). For tools/armor only. */
  damage?: number;
}

interface TrackedItemEntity {
  runtimeId: bigint;
  itemName: string;
  count: number;
  position: Vec3;
  lastSeen: number;
}

interface ContainerState {
  windowId: number;
  windowType: string;
  position: Vec3;
  slots: Map<number, InventoryItem>;
}

interface Attributes {
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
}

const STALE_ENTITY_MS = 120_000; // prune entities not seen for 2 min
const PRUNE_INTERVAL_MS = 30_000;

// Bedrock effect IDs → display names
const EFFECT_NAMES: Record<number, string> = {
  1: 'speed', 2: 'slowness', 3: 'haste', 4: 'mining_fatigue',
  5: 'strength', 6: 'instant_health', 7: 'instant_damage', 8: 'jump_boost',
  9: 'nausea', 10: 'regeneration', 11: 'resistance', 12: 'fire_resistance',
  13: 'water_breathing', 14: 'invisibility', 15: 'blindness', 16: 'night_vision',
  17: 'hunger', 18: 'weakness', 19: 'poison', 20: 'wither',
  21: 'health_boost', 22: 'absorption', 23: 'saturation', 24: 'levitation',
  25: 'fatal_poison', 26: 'conduit_power', 27: 'slow_falling', 28: 'bad_omen',
  29: 'hero_of_the_village', 30: 'darkness',
};

export class WorldState {
  bot: BotState = {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    dimension: 'overworld',
    gamemode: 'survival',
  };

  attributes: Attributes = {
    health: 20,
    maxHealth: 20,
    hunger: 20,
    maxHunger: 20,
  };

  worldTime = 0;
  players: Map<bigint, TrackedPlayer> = new Map();
  entities: Map<bigint, TrackedEntity> = new Map();
  inventory: Map<number, InventoryItem> = new Map();
  itemEntities: Map<bigint, TrackedItemEntity> = new Map();
  heldSlot = 0; // current hotbar slot (0-8)
  openContainer: ContainerState | null = null;
  /** Armor slots: helmet=0, chestplate=1, leggings=2, boots=3 */
  armor: Map<number, InventoryItem> = new Map();
  /** Maps output item name → recipe_network_id from server's crafting_data */
  recipeMap: Map<string, number> = new Map();
  /** Active status effects on the bot */
  statusEffects: Map<number, { name: string; amplifier: number; duration: number; startedAt: number }> = new Map();
  /** Nearby blocks the server has told us about (via update_block). Key = "x,y,z" */
  knownBlocks: Map<string, { x: number; y: number; z: number; runtimeId: number; lastSeen: number }> = new Map();
  /** Maps block runtime_id → block name (populated from start_game block_properties) */
  private blockStateMap: Map<number, string> = new Map();

  private uniqueToRuntime: Map<bigint, bigint> = new Map();
  private itemStateMap: Map<number, string> = new Map(); // network_id -> "minecraft:stone"
  private botRuntimeId: bigint = 0n;
  readonly dataLookup: DataLookup;
  readonly chunkManager: ChunkManager;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private currentClient: Client | null = null;
  private onDeathCallback: ((info: { position: { x: number; y: number; z: number }; dimension: string }) => void) | null = null;

  constructor() {
    this.dataLookup = new DataLookup();
    this.chunkManager = new ChunkManager();
  }

  registerListeners(client: Client): void {
    // Don't double-register on the same client
    if (this.currentClient === client) return;
    this.currentClient = client;

    const c = client as any;

    // Bootstrap from start_game data (available after join)
    if (c.startGameData) {
      const sg = c.startGameData;
      if (sg.player_position) {
        this.bot.position = { x: sg.player_position.x, y: sg.player_position.y, z: sg.player_position.z };
      }
      if (sg.dimension !== undefined) {
        this.bot.dimension = typeof sg.dimension === 'string' ? sg.dimension : this.dimensionName(sg.dimension);
      }
      if (sg.player_gamemode !== undefined) {
        this.bot.gamemode = typeof sg.player_gamemode === 'string' ? sg.player_gamemode : this.gamemodeName(sg.player_gamemode);
      }
      // Item states for name resolution (older protocol versions)
      if (sg.itemstates) {
        for (const item of sg.itemstates) {
          this.itemStateMap.set(item.runtime_id, item.name);
        }
      }
      // "fallback" means use the world's default gamemode
      if (this.bot.gamemode === 'fallback' && sg.world_gamemode !== undefined) {
        this.bot.gamemode = typeof sg.world_gamemode === 'string' ? sg.world_gamemode : this.gamemodeName(sg.world_gamemode);
      }
      // Block palette for name resolution
      if (sg.block_properties) {
        for (const bp of sg.block_properties) {
          if (bp.name && bp.block_runtime_id !== undefined) {
            this.blockStateMap.set(bp.block_runtime_id, bp.name);
          }
        }
      }
      console.log(`[WorldState] Bootstrapped: pos=(${this.bot.position.x.toFixed(1)}, ${this.bot.position.y.toFixed(1)}, ${this.bot.position.z.toFixed(1)}), dim=${this.bot.dimension}, mode=${this.bot.gamemode}`);
    }

    this.botRuntimeId = BigInt(c.entityId ?? 0);

    // Increase max listeners to avoid EventEmitter warnings/limits
    client.setMaxListeners(30);

    // Safe listener wrapper — catches errors to prevent connection drops
    const on = (event: string, handler: (packet: any) => void) => {
      client.on(event as any, (packet: any) => {
        try {
          handler(packet);
        } catch (err: any) {
          console.error(`[WorldState] Error in ${event} handler: ${err.message}`);
        }
      });
    };

    // Item registry (1.21.60+ sends this separately)
    on('item_registry', (packet: any) => {
      if (packet.itemstates) {
        for (const item of packet.itemstates) {
          this.itemStateMap.set(item.runtime_id, item.name);
        }
        console.log(`[WorldState] Loaded ${this.itemStateMap.size} item states from item_registry`);
      }
    });

    // Position tracking
    on('move_player', (packet: any) => {
      const rid = BigInt(packet.runtime_id ?? 0);
      const pos = packet.position;
      if (!pos) return;

      if (rid === this.botRuntimeId) {
        this.bot.position = { x: pos.x, y: pos.y, z: pos.z };
        this.bot.yaw = packet.yaw ?? this.bot.yaw;
        this.bot.pitch = packet.pitch ?? this.bot.pitch;
      } else {
        // Update tracked player position (or create if we missed add_player)
        let player = this.players.get(rid);
        if (!player) {
          // Player was already in world before bot joined — create entry from movement
          player = {
            username: `Player_${rid}`,
            runtimeId: rid,
            uniqueId: 0n,
            position: { x: pos.x, y: pos.y, z: pos.z },
            yaw: packet.yaw ?? 0,
            lastSeen: Date.now(),
          };
          this.players.set(rid, player);
          console.log(`[WorldState] Discovered player via movement: runtime_id=${rid} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
        } else {
          player.position = { x: pos.x, y: pos.y, z: pos.z };
          player.yaw = packet.yaw ?? player.yaw;
          player.lastSeen = Date.now();
        }
      }
    });

    // Player tracking
    on('add_player', (packet: any) => {
      const rid = BigInt(packet.runtime_id ?? 0);
      const uid = BigInt(packet.unique_id ?? 0);
      const pos = packet.position ?? { x: 0, y: 0, z: 0 };
      const username = packet.username ?? 'Unknown';

      // Update existing entry or create new one
      const existing = this.players.get(rid);
      if (existing) {
        existing.username = username;
        existing.uniqueId = uid;
        existing.position = { x: pos.x, y: pos.y, z: pos.z };
        existing.lastSeen = Date.now();
      } else {
        this.players.set(rid, {
          username,
          runtimeId: rid,
          uniqueId: uid,
          position: { x: pos.x, y: pos.y, z: pos.z },
          yaw: packet.yaw ?? 0,
          lastSeen: Date.now(),
        });
      }
      this.uniqueToRuntime.set(uid, rid);
      console.log(`[WorldState] Player added: ${username} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
    });

    // Entity tracking (mobs)
    on('add_entity', (packet: any) => {
      const rid = BigInt(packet.runtime_id ?? 0);
      const uid = BigInt(packet.unique_id ?? 0);
      const pos = packet.position ?? { x: 0, y: 0, z: 0 };
      const entityType = packet.entity_type ?? 'unknown';
      const info = this.dataLookup.getEntityInfo(entityType);
      const entity: TrackedEntity = {
        entityType,
        displayName: info.displayName,
        category: info.category,
        runtimeId: rid,
        uniqueId: uid,
        position: { x: pos.x, y: pos.y, z: pos.z },
        lastSeen: Date.now(),
      };
      this.entities.set(rid, entity);
      this.uniqueToRuntime.set(uid, rid);
      // Only log non-trivial entities (skip items, xp orbs, etc.)
      if (info.category !== 'other') {
        console.log(`[WorldState] Entity: ${info.displayName} (${info.category}) at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
      }
    });

    // Entity movement (delta — fields only present when flags indicate change)
    on('move_entity_delta', (packet: any) => {
      const rid = BigInt(packet.runtime_entity_id ?? 0);
      const entity = this.entities.get(rid);
      if (entity) {
        if (packet.x !== undefined) entity.position.x = packet.x;
        if (packet.y !== undefined) entity.position.y = packet.y;
        if (packet.z !== undefined) entity.position.z = packet.z;
        entity.lastSeen = Date.now();
      }
      // Also check players (move_entity_delta can fire for players too)
      const player = this.players.get(rid);
      if (player) {
        if (packet.x !== undefined) player.position.x = packet.x;
        if (packet.y !== undefined) player.position.y = packet.y;
        if (packet.z !== undefined) player.position.z = packet.z;
        player.lastSeen = Date.now();
      }
    });

    // Entity removal
    on('remove_entity', (packet: any) => {
      const uid = BigInt(packet.entity_id_self ?? 0);
      const rid = this.uniqueToRuntime.get(uid);
      if (rid !== undefined) {
        const player = this.players.get(rid);
        if (player) {
          console.log(`[WorldState] Player removed: ${player.username}`);
          this.players.delete(rid);
        }
        this.entities.delete(rid);
        this.uniqueToRuntime.delete(uid);
      }
    });

    // Time
    on('set_time', (packet: any) => {
      this.worldTime = Number(packet.time ?? 0);
    });

    // Attributes (health, hunger)
    on('update_attributes', (packet: any) => {
      const rid = BigInt(packet.runtime_entity_id ?? 0);
      if (rid !== this.botRuntimeId) return;
      for (const attr of packet.attributes ?? []) {
        switch (attr.name) {
          case 'minecraft:health':
            this.attributes.health = attr.current ?? attr.value ?? this.attributes.health;
            this.attributes.maxHealth = attr.max ?? this.attributes.maxHealth;
            break;
          case 'minecraft:player.hunger':
            this.attributes.hunger = attr.current ?? attr.value ?? this.attributes.hunger;
            this.attributes.maxHunger = attr.max ?? this.attributes.maxHunger;
            break;
        }
      }
    });

    // Inventory
    on('inventory_content', (packet: any) => {
      const windowId = packet.window_id;
      // Only track player inventory (window 0)
      if (windowId !== 0 && windowId !== 'inventory') return;
      this.inventory.clear();
      const items = packet.input ?? [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const networkId = item.network_id ?? 0;
        if (networkId === 0) continue; // empty slot
        const name = this.resolveItemName(networkId);
        this.inventory.set(i, {
          slot: i,
          name,
          count: item.count ?? 1,
          networkId,
          damage: item.metadata ?? 0,
        });
      }
    });

    on('inventory_slot', (packet: any) => {
      const windowId = packet.window_id;
      if (windowId !== 0 && windowId !== 'inventory') return;
      const slot = packet.slot ?? 0;
      const item = packet.item;
      if (!item || (item.network_id ?? 0) === 0) {
        this.inventory.delete(slot);
      } else {
        this.inventory.set(slot, {
          slot,
          name: this.resolveItemName(item.network_id),
          count: item.count ?? 1,
          networkId: item.network_id,
          damage: item.metadata ?? 0,
        });
      }
    });

    // Respawn — record death at current position before updating
    on('respawn', (packet: any) => {
      if (this.onDeathCallback) {
        this.onDeathCallback({
          position: { ...this.bot.position },
          dimension: this.bot.dimension,
        });
      }
      if (packet.position) {
        this.bot.position = { x: packet.position.x, y: packet.position.y, z: packet.position.z };
      }
    });

    // Dimension change
    on('change_dimension', (packet: any) => {
      if (packet.dimension !== undefined) {
        this.bot.dimension = this.dimensionName(packet.dimension);
      }
      if (packet.position) {
        this.bot.position = { x: packet.position.x, y: packet.position.y, z: packet.position.z };
      }
    });

    // Dropped item entities
    on('add_item_actor', (packet: any) => {
      const rid = BigInt(packet.runtime_entity_id ?? packet.entity_id_self ?? 0);
      const pos = packet.position ?? { x: 0, y: 0, z: 0 };
      const item = packet.item;
      const networkId = item?.network_id ?? 0;
      if (networkId === 0) return;
      const itemName = this.resolveItemName(networkId);
      this.itemEntities.set(rid, {
        runtimeId: rid,
        itemName,
        count: item?.count ?? 1,
        position: { x: pos.x, y: pos.y, z: pos.z },
        lastSeen: Date.now(),
      });
    });

    // Track item entity removal (picked up or despawned)
    // remove_entity already handles this via entities.delete, but item entities
    // are in a separate map, so also check there
    const origRemoveHandler = client.listeners('remove_entity');
    on('remove_entity', (packet: any) => {
      const uid = BigInt(packet.entity_id_self ?? 0);
      const rid = this.uniqueToRuntime.get(uid);
      if (rid !== undefined) {
        this.itemEntities.delete(rid);
      }
      // Also try direct runtime ID removal (some packets use runtime_id)
      if (packet.runtime_entity_id) {
        this.itemEntities.delete(BigInt(packet.runtime_entity_id));
      }
    });

    // Track held slot changes (mob_equipment for bot)
    on('mob_equipment', (packet: any) => {
      const rid = BigInt(packet.runtime_entity_id ?? 0);
      if (rid === this.botRuntimeId) {
        this.heldSlot = packet.selected_slot ?? this.heldSlot;
      }
    });

    // Armor equipment tracking
    on('mob_armor_equipment', (packet: any) => {
      const rid = BigInt(packet.runtime_entity_id ?? 0);
      if (rid !== this.botRuntimeId) return;
      const slots = [
        { idx: 0, key: 'helmet' },
        { idx: 1, key: 'chestplate' },
        { idx: 2, key: 'leggings' },
        { idx: 3, key: 'boots' },
      ];
      for (const { idx, key } of slots) {
        const item = packet[key];
        const networkId = item?.network_id ?? 0;
        if (networkId === 0) {
          this.armor.delete(idx);
        } else {
          this.armor.set(idx, {
            slot: idx,
            name: this.resolveItemName(networkId),
            count: 1,
            networkId,
          });
        }
      }
    });

    // Status effects (poison, speed, strength, etc.)
    on('mob_effect', (packet: any) => {
      const rid = BigInt(packet.runtime_entity_id ?? 0);
      if (rid !== this.botRuntimeId) return;
      const effectId = packet.effect_id ?? 0;
      const eventId = packet.event_id ?? packet.event ?? '';
      // event_id: 'add' or 'modify' = set effect, 'remove' = remove
      if (eventId === 'remove') {
        this.statusEffects.delete(effectId);
      } else {
        this.statusEffects.set(effectId, {
          name: EFFECT_NAMES[effectId] ?? `effect#${effectId}`,
          amplifier: packet.amplifier ?? 0,
          duration: packet.duration ?? 0,
          startedAt: Date.now(),
        });
      }
    });

    // Track nearby block updates from server
    on('update_block', (packet: any) => {
      const pos = packet.position;
      if (!pos) return;
      const rid = packet.block_runtime_id ?? 0;
      const key = `${pos.x},${pos.y},${pos.z}`;
      // Only track blocks within 16 blocks of bot
      const dist = Math.sqrt(
        (pos.x - this.bot.position.x) ** 2 +
        (pos.y - this.bot.position.y) ** 2 +
        (pos.z - this.bot.position.z) ** 2
      );
      if (dist <= 16) {
        if (rid === 0) {
          this.knownBlocks.delete(key); // air = block removed
        } else {
          this.knownBlocks.set(key, { x: pos.x, y: pos.y, z: pos.z, runtimeId: rid, lastSeen: Date.now() });
        }
      }
    });

    // Container open (chest, crafting table, furnace, etc.)
    on('container_open', (packet: any) => {
      const windowId = packet.window_id ?? 0;
      const windowType = packet.window_type ?? 'unknown';
      const pos = packet.position ?? { x: 0, y: 0, z: 0 };
      this.openContainer = {
        windowId,
        windowType,
        position: { x: pos.x, y: pos.y, z: pos.z },
        slots: new Map(),
      };
      console.log(`[WorldState] Container opened: ${windowType} at (${pos.x}, ${pos.y}, ${pos.z})`);
    });

    // Container close
    on('container_close', (packet: any) => {
      if (this.openContainer) {
        console.log(`[WorldState] Container closed: ${this.openContainer.windowType}`);
        this.openContainer = null;
      }
    });

    // Container inventory (updates slots in open container)
    on('inventory_content', (packet: any) => {
      const windowId = packet.window_id;
      if (this.openContainer && windowId === this.openContainer.windowId) {
        this.openContainer.slots.clear();
        const items = packet.input ?? [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const networkId = item.network_id ?? 0;
          if (networkId === 0) continue;
          this.openContainer.slots.set(i, {
            slot: i,
            name: this.resolveItemName(networkId),
            count: item.count ?? 1,
            networkId,
          });
        }
      }
    });

    // Crafting recipes from server
    on('crafting_data', (packet: any) => {
      const recipes = packet.recipes ?? [];
      for (const entry of recipes) {
        const r = entry.recipe ?? entry;
        const netId = r.network_id ?? r.recipe_network_id ?? 0;
        if (!netId) continue;
        // Shaped and shapeless recipes have an output array
        const outputs = r.output ?? r.result ?? [];
        const outputArr = Array.isArray(outputs) ? outputs : [outputs];
        for (const out of outputArr) {
          const outId = out.network_id ?? 0;
          if (outId === 0) continue;
          const name = this.resolveItemName(outId);
          if (name && !name.startsWith('item#')) {
            this.recipeMap.set(name.toLowerCase(), netId);
          }
        }
      }
      if (this.recipeMap.size > 0) {
        console.log(`[WorldState] Loaded ${this.recipeMap.size} crafting recipes from server`);
      }
    });

    // Register chunk manager for block-level world scanning
    this.chunkManager.registerListeners(client);

    // Periodic stale entity pruning
    this.pruneTimer = setInterval(() => this.pruneStale(), PRUNE_INTERVAL_MS);
  }

  // Look up a player by username (case-insensitive)
  getPlayerByName(name: string): TrackedPlayer | undefined {
    const lower = name.toLowerCase();
    for (const player of this.players.values()) {
      if (player.username.toLowerCase() === lower) {
        return player;
      }
    }
    return undefined;
  }

  getBotRuntimeId(): bigint {
    return this.botRuntimeId;
  }

  // Get item in a specific hotbar slot (0-8)
  getHotbarItem(slot: number): InventoryItem | undefined {
    return this.inventory.get(slot);
  }

  // Get the currently held item
  getHeldItem(): InventoryItem | undefined {
    return this.inventory.get(this.heldSlot);
  }

  // Find an item in hotbar by partial name match (case-insensitive)
  findHotbarItem(name: string): { slot: number; item: InventoryItem } | undefined {
    const lower = name.toLowerCase();
    for (let slot = 0; slot < 9; slot++) {
      const item = this.inventory.get(slot);
      if (item && item.name.toLowerCase().includes(lower)) {
        return { slot, item };
      }
    }
    return undefined;
  }

  // Find an item anywhere in inventory by partial name match
  findInventoryItem(name: string): { slot: number; item: InventoryItem } | undefined {
    const lower = name.toLowerCase();
    for (const [slot, item] of this.inventory) {
      if (item.name.toLowerCase().includes(lower)) {
        return { slot, item };
      }
    }
    return undefined;
  }

  // Get nearby dropped items
  getNearbyItemEntities(radius: number): TrackedItemEntity[] {
    const result: TrackedItemEntity[] = [];
    for (const item of this.itemEntities.values()) {
      if (this.distanceTo(item.position) <= radius) {
        result.push(item);
      }
    }
    return result.sort((a, b) => this.distanceTo(a.position) - this.distanceTo(b.position));
  }

  // Associate a gamertag with a tracked player (called when we see chat from them)
  resolvePlayerName(username: string): void {
    for (const player of this.players.values()) {
      if (player.username.startsWith('Player_')) {
        player.username = username;
        console.log(`[WorldState] Resolved player name: ${username} (runtime_id=${player.runtimeId})`);
        return;
      }
    }
  }

  cleanup(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  /** Register a callback for when the bot dies (fired before respawn position update). */
  setOnDeath(cb: (info: { position: { x: number; y: number; z: number }; dimension: string }) => void): void {
    this.onDeathCallback = cb;
  }

  getWorldContext(): string {
    const lines: string[] = [];

    // Position & facing
    const p = this.bot.position;
    const facing = this.yawToDirection(this.bot.yaw);
    lines.push(`POSITION: x=${p.x.toFixed(0)}, y=${p.y.toFixed(0)}, z=${p.z.toFixed(0)} (facing ${facing})`);
    lines.push(`DIMENSION: ${this.bot.dimension}`);
    lines.push(`GAMEMODE: ${this.bot.gamemode}`);

    // Time
    const timeLabel = this.timeOfDay(this.worldTime);
    lines.push(`TIME: ${timeLabel}`);

    // Health/hunger (skip in creative)
    if (this.bot.gamemode !== 'creative') {
      lines.push(`HEALTH: ${this.attributes.health.toFixed(0)}/${this.attributes.maxHealth.toFixed(0)}, HUNGER: ${this.attributes.hunger.toFixed(0)}/${this.attributes.maxHunger.toFixed(0)}`);
    }

    // Nearby players
    const nearbyPlayers = this.getNearbyPlayers(64);
    if (nearbyPlayers.length > 0) {
      lines.push('');
      lines.push('NEARBY PLAYERS:');
      for (const pl of nearbyPlayers) {
        const dist = this.distanceTo(pl.position);
        const dir = this.directionTo(pl.position);
        lines.push(`- "${pl.username}" ${dist.toFixed(0)} blocks ${dir}`);
      }
    }

    // Nearby entities (hostile first, then passive, limit to top 10)
    const nearbyEntities = this.getNearbyEntities(32);
    if (nearbyEntities.length > 0) {
      lines.push('');
      lines.push('NEARBY ENTITIES:');
      // Sort: hostile first
      nearbyEntities.sort((a, b) => {
        if (a.category === 'hostile' && b.category !== 'hostile') return -1;
        if (a.category !== 'hostile' && b.category === 'hostile') return 1;
        return this.distanceTo(a.position) - this.distanceTo(b.position);
      });
      for (const ent of nearbyEntities.slice(0, 10)) {
        const dist = this.distanceTo(ent.position);
        const dir = this.directionTo(ent.position);
        lines.push(`- ${ent.displayName} (${ent.category}) ${dist.toFixed(0)} blocks ${dir}`);
      }
    }

    // Active status effects
    if (this.statusEffects.size > 0) {
      const now = Date.now();
      const effectParts: string[] = [];
      for (const [, eff] of this.statusEffects) {
        const elapsed = (now - eff.startedAt) / 1000;
        const remaining = Math.max(0, eff.duration - elapsed);
        if (remaining > 0) {
          const lvl = eff.amplifier > 0 ? ` ${['I', 'II', 'III', 'IV', 'V'][eff.amplifier] ?? eff.amplifier + 1}` : '';
          effectParts.push(`${eff.name}${lvl} (${Math.ceil(remaining)}s)`);
        }
      }
      if (effectParts.length > 0) {
        lines.push(`EFFECTS: ${effectParts.join(', ')}`);
      }
    }

    // Held item
    const heldItem = this.getHeldItem();
    if (heldItem) {
      lines.push(`HELD ITEM: ${heldItem.name} (slot ${this.heldSlot})`);
    }

    // Armor
    if (this.armor.size > 0) {
      const slotNames = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
      const armorParts: string[] = [];
      for (let i = 0; i < 4; i++) {
        const item = this.armor.get(i);
        if (item) {
          const durPct = this.dataLookup.getDurabilityPercent(item.name, item.damage ?? 0);
          const durStr = durPct !== null ? ` (${durPct}%)` : '';
          armorParts.push(`${slotNames[i]}: ${item.name}${durStr}`);
        }
      }
      lines.push(`ARMOR: ${armorParts.join(', ')}`);
    } else {
      lines.push('ARMOR: none');
    }

    // Inventory (non-empty slots, grouped by item)
    if (this.inventory.size > 0) {
      const stackable = new Map<string, number>(); // name → total count
      const durableItems: string[] = []; // individual tool/armor lines
      const hotbarItems: string[] = [];
      for (const [slot, item] of this.inventory) {
        const durPct = this.dataLookup.getDurabilityPercent(item.name, item.damage ?? 0);
        if (durPct !== null) {
          // Durable item (tool/armor) — list individually
          durableItems.push(`${item.name} (${durPct}%) [slot ${slot}]`);
        } else {
          // Stackable item — group by name
          stackable.set(item.name, (stackable.get(item.name) ?? 0) + item.count);
        }
        if (slot < 9) {
          const durStr = durPct !== null ? ` (${durPct}%)` : '';
          hotbarItems.push(`[${slot}] ${item.name}${item.count > 1 ? ` x${item.count}` : ''}${durStr}`);
        }
      }
      lines.push('');
      if (hotbarItems.length > 0) {
        lines.push(`HOTBAR: ${hotbarItems.join(', ')}`);
      }
      lines.push('INVENTORY:');
      for (const entry of durableItems) {
        lines.push(`- ${entry}`);
      }
      for (const [name, count] of stackable) {
        lines.push(`- ${name} x${count}`);
      }
    }

    // Nearby dropped items
    const nearbyItems = this.getNearbyItemEntities(16);
    if (nearbyItems.length > 0) {
      lines.push('');
      lines.push('DROPPED ITEMS NEARBY:');
      for (const item of nearbyItems.slice(0, 5)) {
        const dist = this.distanceTo(item.position);
        const dir = this.directionTo(item.position);
        lines.push(`- ${item.itemName} x${item.count} ${dist.toFixed(0)} blocks ${dir}`);
      }
    }

    // Notable blocks nearby
    const notableBlocks = this.getNearbyNotableBlocks(16);
    if (notableBlocks.length > 0) {
      lines.push('');
      lines.push('NEARBY BLOCKS:');
      for (const block of notableBlocks) {
        const dir = this.directionTo({ x: block.x, y: block.y, z: block.z });
        lines.push(`- ${block.name} at (${block.x}, ${block.y}, ${block.z}) ${block.dist.toFixed(0)} blocks ${dir}`);
      }
    }

    // Open container
    if (this.openContainer) {
      lines.push('');
      lines.push(`OPEN CONTAINER: ${this.openContainer.windowType} at (${this.openContainer.position.x}, ${this.openContainer.position.y}, ${this.openContainer.position.z})`);
      if (this.openContainer.slots.size > 0) {
        for (const [slot, item] of this.openContainer.slots) {
          lines.push(`  [${slot}] ${item.name} x${item.count}`);
        }
      } else {
        lines.push('  (empty)');
      }
    }

    return lines.join('\n');
  }

  private getNearbyPlayers(radius: number): TrackedPlayer[] {
    const result: TrackedPlayer[] = [];
    for (const player of this.players.values()) {
      if (this.distanceTo(player.position) <= radius) {
        result.push(player);
      }
    }
    return result.sort((a, b) => this.distanceTo(a.position) - this.distanceTo(b.position));
  }

  private getNearbyEntities(radius: number): TrackedEntity[] {
    const result: TrackedEntity[] = [];
    for (const entity of this.entities.values()) {
      if (this.distanceTo(entity.position) <= radius) {
        result.push(entity);
      }
    }
    return result;
  }

  private distanceTo(pos: Vec3): number {
    const dx = pos.x - this.bot.position.x;
    const dy = pos.y - this.bot.position.y;
    const dz = pos.z - this.bot.position.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private directionTo(pos: Vec3): string {
    const dx = pos.x - this.bot.position.x;
    const dz = pos.z - this.bot.position.z;
    const angle = Math.atan2(-dx, dz) * (180 / Math.PI);
    return this.angleToDirection(angle);
  }

  private yawToDirection(yaw: number): string {
    return this.angleToDirection(yaw);
  }

  private angleToDirection(angle: number): string {
    // Normalize to 0-360
    const a = ((angle % 360) + 360) % 360;
    if (a >= 337.5 || a < 22.5) return 'south';
    if (a < 67.5) return 'southwest';
    if (a < 112.5) return 'west';
    if (a < 157.5) return 'northwest';
    if (a < 202.5) return 'north';
    if (a < 247.5) return 'northeast';
    if (a < 292.5) return 'east';
    return 'southeast';
  }

  private timeOfDay(ticks: number): string {
    const t = ((ticks % 24000) + 24000) % 24000;
    if (t < 6000) return 'sunrise';
    if (t < 12000) return 'day';
    if (t < 13800) return 'sunset';
    if (t < 22200) return 'night';
    return 'sunrise';
  }

  private dimensionName(id: number): string {
    switch (id) {
      case 0: return 'overworld';
      case 1: return 'nether';
      case 2: return 'the end';
      default: return 'unknown';
    }
  }

  private gamemodeName(id: number): string {
    switch (id) {
      case 0: return 'survival';
      case 1: return 'creative';
      case 2: return 'adventure';
      case 3: return 'spectator';
      default: return 'unknown';
    }
  }

  private resolveItemName(networkId: number): string {
    const stateName = this.itemStateMap.get(networkId);
    if (stateName) {
      return this.dataLookup.getItemName(stateName);
    }
    return `item#${networkId}`;
  }

  /** Resolve a block runtime_id to a block name. */
  resolveBlockName(runtimeId: number): string {
    return this.blockStateMap.get(runtimeId) ?? `block#${runtimeId}`;
  }

  /** Get notable blocks near the bot (ores, containers, beds, etc.). */
  getNearbyNotableBlocks(radius: number): { name: string; x: number; y: number; z: number; dist: number }[] {
    const notable: { name: string; x: number; y: number; z: number; dist: number }[] = [];
    const notableKeywords = [
      'ore', 'chest', 'furnace', 'crafting', 'anvil', 'enchant', 'bed', 'barrel',
      'brewing', 'smoker', 'blast', 'grindstone', 'loom', 'stonecutter', 'lectern',
      'beacon', 'spawner', 'portal', 'obsidian',
    ];

    for (const [, block] of this.knownBlocks) {
      const dist = Math.sqrt(
        (block.x - this.bot.position.x) ** 2 +
        (block.y - this.bot.position.y) ** 2 +
        (block.z - this.bot.position.z) ** 2
      );
      if (dist > radius) continue;
      const name = this.resolveBlockName(block.runtimeId).replace('minecraft:', '');
      if (notableKeywords.some(kw => name.includes(kw))) {
        notable.push({ name, x: block.x, y: block.y, z: block.z, dist });
      }
    }
    return notable.sort((a, b) => a.dist - b.dist).slice(0, 10);
  }

  private pruneStale(): void {
    const now = Date.now();
    for (const [rid, entity] of this.entities) {
      if (now - entity.lastSeen > STALE_ENTITY_MS) {
        this.entities.delete(rid);
      }
    }
    for (const [rid, item] of this.itemEntities) {
      if (now - item.lastSeen > STALE_ENTITY_MS) {
        this.itemEntities.delete(rid);
      }
    }
    // Prune known blocks that are far from bot
    for (const [key, block] of this.knownBlocks) {
      const dist = Math.sqrt(
        (block.x - this.bot.position.x) ** 2 +
        (block.y - this.bot.position.y) ** 2 +
        (block.z - this.bot.position.z) ** 2
      );
      if (dist > 32) {
        this.knownBlocks.delete(key);
      }
    }
  }
}
