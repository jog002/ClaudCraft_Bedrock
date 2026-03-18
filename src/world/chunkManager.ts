/**
 * ChunkManager — stores decoded chunk data and provides spatial queries.
 *
 * Responsibilities:
 * - Listens for level_chunk and subchunk packets, stores raw payloads
 * - Decodes subchunk payloads on demand
 * - Maps block runtime IDs to block names
 * - Provides query methods: getBlock, scanNearby, deepScan
 */
import { Client } from 'bedrock-protocol';
import {
  decodeSubChunkPayload, DecodedSubChunk,
  worldToChunk, worldToSubChunk, indexToLocal,
} from './chunkDecoder';

// ─── Types ──────────────────────────────────────────────────────────────

export interface BlockHit {
  name: string;
  x: number;
  y: number;
  z: number;
  dist: number;
}

interface StoredChunk {
  x: number;
  z: number;
  /** Maps subchunk Y index → raw payload buffer */
  subchunks: Map<number, Buffer>;
  /** Maps subchunk Y index → decoded data (lazy, cached) */
  decoded: Map<number, DecodedSubChunk | null>;
  receivedAt: number;
}

// Notable blocks worth reporting in scans
const SCAN_TARGETS: Record<string, string> = {
  // Ores
  diamond_ore: 'diamond_ore', deepslate_diamond_ore: 'diamond_ore',
  emerald_ore: 'emerald_ore', deepslate_emerald_ore: 'emerald_ore',
  gold_ore: 'gold_ore', deepslate_gold_ore: 'gold_ore',
  iron_ore: 'iron_ore', deepslate_iron_ore: 'iron_ore',
  copper_ore: 'copper_ore', deepslate_copper_ore: 'copper_ore',
  coal_ore: 'coal_ore', deepslate_coal_ore: 'coal_ore',
  lapis_ore: 'lapis_ore', deepslate_lapis_ore: 'lapis_ore',
  redstone_ore: 'redstone_ore', deepslate_redstone_ore: 'redstone_ore',
  ancient_debris: 'ancient_debris',
  // Containers & structures
  chest: 'chest', trapped_chest: 'trapped_chest', barrel: 'barrel',
  ender_chest: 'ender_chest', shulker_box: 'shulker_box',
  // Functional blocks
  crafting_table: 'crafting_table', furnace: 'furnace', lit_furnace: 'furnace',
  blast_furnace: 'blast_furnace', smoker: 'smoker', lit_smoker: 'smoker',
  brewing_stand: 'brewing_stand', enchanting_table: 'enchanting_table',
  anvil: 'anvil', grindstone: 'grindstone', smithing_table: 'smithing_table',
  // Hazards
  lava: 'lava', flowing_lava: 'lava',
  // Structures
  spawner: 'spawner', mob_spawner: 'spawner',
  end_portal_frame: 'end_portal_frame', end_portal: 'end_portal',
  nether_portal: 'nether_portal',
  // Beds
  bed: 'bed',
  // Other valuable
  obsidian: 'obsidian', crying_obsidian: 'crying_obsidian',
  beacon: 'beacon',
};

// ─── ChunkManager ───────────────────────────────────────────────────────

export class ChunkManager {
  /** Stored chunks: key = "cx,cz" */
  private chunks: Map<string, StoredChunk> = new Map();
  /** Block runtime ID → block name (e.g., "minecraft:stone" → "stone") */
  private blockPalette: Map<number, string> = new Map();
  private registered = false;
  /** When true, subchunk payloads are stored. Set true during scans, false otherwise. */
  private collectingSubchunks = false;

  /**
   * Initialize the block palette from start_game data.
   * Called once after connection with the block_properties from start_game.
   */
  loadBlockPalette(blockProperties: any[]): void {
    for (const bp of blockProperties) {
      if (bp.name && bp.block_runtime_id !== undefined) {
        // Strip "minecraft:" prefix for cleaner names
        const name = (bp.name as string).replace('minecraft:', '');
        this.blockPalette.set(bp.block_runtime_id, name);
      }
    }
    console.log(`[ChunkManager] Loaded ${this.blockPalette.size} block palette entries`);
  }

  /** Resolve a block runtime ID to a clean block name. */
  resolveBlock(runtimeId: number): string {
    return this.blockPalette.get(runtimeId) ?? `block#${runtimeId}`;
  }

  /**
   * Register packet listeners on a bedrock-protocol client.
   */
  registerListeners(client: Client): void {
    if (this.registered) return;
    this.registered = true;

    const c = client as any;

    // Bootstrap block palette from start_game
    if (c.startGameData?.block_properties) {
      this.loadBlockPalette(c.startGameData.block_properties);
    }

    const on = (event: string, handler: (packet: any) => void) => {
      client.on(event as any, (packet: any) => {
        try {
          handler(packet);
        } catch (err: any) {
          console.error(`[ChunkManager] Error in ${event}: ${err.message}`);
        }
      });
    };

    // level_chunk — full chunk column
    // We store only metadata (chunk exists), NOT the raw payload.
    // level_chunk payloads contain multiple variable-length subchunks
    // concatenated together — splitting them requires sequential decoding
    // which is expensive. Instead, we record that this chunk was received
    // and rely on subchunk_request/subchunk for actual block data when
    // a scan is triggered.
    on('level_chunk', (packet: any) => {
      const cx = packet.x;
      const cz = packet.z;
      const subChunkCount = packet.sub_chunk_count ?? 0;

      // sub_chunk_count < 0 means server uses subchunk request protocol
      if (subChunkCount < 0) return;

      const key = `${cx},${cz}`;
      if (!this.chunks.has(key)) {
        this.chunks.set(key, {
          x: cx, z: cz,
          subchunks: new Map(),
          decoded: new Map(),
          receivedAt: Date.now(),
        });
      }
    });

    // subchunk — individual subchunk responses (from subchunk_request)
    // Only stored when collectingSubchunks is true (during active scans)
    on('subchunk', (packet: any) => {
      if (!this.collectingSubchunks) return;

      const origin = packet.origin ?? { x: 0, y: 0, z: 0 };
      const entries = packet.entries ?? [];

      for (const entry of entries) {
        const result = entry.result ?? 0;
        // 1 = success, 6 = success_all_air
        if (result !== 1 && result !== 6) continue;

        const dx = entry.dx ?? 0;
        const dy = entry.dy ?? 0;
        const dz = entry.dz ?? 0;

        // Convert origin + offset to chunk/subchunk coords
        const cx = origin.x + dx;
        const cz = origin.z + dz;
        const subY = origin.y + dy;
        const key = `${cx},${cz}`;

        let chunk = this.chunks.get(key);
        if (!chunk) {
          chunk = {
            x: cx, z: cz,
            subchunks: new Map(),
            decoded: new Map(),
            receivedAt: Date.now(),
          };
          this.chunks.set(key, chunk);
        }

        if (result === 6) {
          // All air — store empty decoded result
          chunk.decoded.set(subY, {
            blockIds: new Int32Array(4096),
            palette: [0],
          });
        } else if (entry.payload && entry.payload.length > 0) {
          const payloadBuf = entry.payload instanceof Buffer
            ? entry.payload
            : Buffer.from(entry.payload);
          chunk.subchunks.set(subY, payloadBuf);
          chunk.decoded.delete(subY); // invalidate cache
        }

        chunk.receivedAt = Date.now();
      }
    });

    // Prune distant chunks periodically
    setInterval(() => this.pruneDistant(), 30000);
  }

  /**
   * Get the decoded block at world coordinates.
   * Returns the block name or null if chunk data isn't available.
   */
  getBlockAt(wx: number, wy: number, wz: number): string | null {
    const cx = Math.floor(wx) >> 4;
    const cz = Math.floor(wz) >> 4;
    const subY = Math.floor(wy) >> 4;
    const key = `${cx},${cz}`;

    const chunk = this.chunks.get(key);
    if (!chunk) return null;

    const decoded = this.getDecodedSubchunk(chunk, subY);
    if (!decoded) return null;

    const lx = ((Math.floor(wx) % 16) + 16) % 16;
    const ly = ((Math.floor(wy) % 16) + 16) % 16;
    const lz = ((Math.floor(wz) % 16) + 16) % 16;
    const idx = ly | (lz << 4) | (lx << 8);

    const runtimeId = decoded.blockIds[idx];
    if (runtimeId === 0) return 'air';
    return this.resolveBlock(runtimeId);
  }

  /**
   * Scan a cubic area around a center point for notable blocks.
   * radius is in blocks.
   */
  scanArea(centerX: number, centerY: number, centerZ: number, radius: number): BlockHit[] {
    const hits: BlockHit[] = [];
    const minX = Math.floor(centerX - radius);
    const maxX = Math.floor(centerX + radius);
    const minY = Math.floor(centerY - radius);
    const maxY = Math.floor(centerY + radius);
    const minZ = Math.floor(centerZ - radius);
    const maxZ = Math.floor(centerZ + radius);

    // Iterate by subchunk to minimize decode calls
    const minCX = minX >> 4;
    const maxCX = maxX >> 4;
    const minCZ = minZ >> 4;
    const maxCZ = maxZ >> 4;
    const minSY = minY >> 4;
    const maxSY = maxY >> 4;

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const key = `${cx},${cz}`;
        const chunk = this.chunks.get(key);
        if (!chunk) continue;

        for (let sy = minSY; sy <= maxSY; sy++) {
          const decoded = this.getDecodedSubchunk(chunk, sy);
          if (!decoded) continue;

          // Scan all 4096 blocks in this subchunk
          for (let idx = 0; idx < 4096; idx++) {
            const runtimeId = decoded.blockIds[idx];
            if (runtimeId === 0) continue; // air

            const blockName = this.resolveBlock(runtimeId);
            const category = SCAN_TARGETS[blockName];
            if (!category) continue;

            const { x: lx, y: ly, z: lz } = indexToLocal(idx);
            const wx = cx * 16 + lx;
            const wy = sy * 16 + ly;
            const wz = cz * 16 + lz;

            // Check if within radius
            if (wx < minX || wx > maxX || wy < minY || wy > maxY || wz < minZ || wz > maxZ) continue;

            const dist = Math.sqrt(
              (wx - centerX) ** 2 + (wy - centerY) ** 2 + (wz - centerZ) ** 2
            );

            hits.push({ name: category, x: wx, y: wy, z: wz, dist });
          }
        }
      }
    }

    return hits.sort((a, b) => a.dist - b.dist);
  }

  /**
   * Deep scan — scan ALL loaded chunks for target blocks.
   * Returns grouped results sorted by distance.
   */
  deepScan(centerX: number, centerY: number, centerZ: number, filter?: string[]): BlockHit[] {
    const hits: BlockHit[] = [];
    const filterSet = filter ? new Set(filter.map(f => f.toLowerCase())) : null;

    for (const [, chunk] of this.chunks) {
      // Get all subchunk Y indices we have data for
      const subYs = new Set([...chunk.subchunks.keys(), ...chunk.decoded.keys()]);

      for (const sy of subYs) {
        if (sy === -999) continue; // skip sentinel
        const decoded = this.getDecodedSubchunk(chunk, sy);
        if (!decoded) continue;

        for (let idx = 0; idx < 4096; idx++) {
          const runtimeId = decoded.blockIds[idx];
          if (runtimeId === 0) continue;

          const blockName = this.resolveBlock(runtimeId);
          const category = SCAN_TARGETS[blockName];
          if (!category) continue;

          // Apply filter if provided
          if (filterSet && !filterSet.has(category) && !filterSet.has(blockName)) continue;

          const { x: lx, y: ly, z: lz } = indexToLocal(idx);
          const wx = chunk.x * 16 + lx;
          const wy = sy * 16 + ly;
          const wz = chunk.z * 16 + lz;

          const dist = Math.sqrt(
            (wx - centerX) ** 2 + (wy - centerY) ** 2 + (wz - centerZ) ** 2
          );

          hits.push({ name: category, x: wx, y: wy, z: wz, dist });
        }
      }
    }

    return hits.sort((a, b) => a.dist - b.dist);
  }

  /**
   * Request subchunks around a position from the server.
   * Sends subchunk_request packet and waits for responses.
   */
  /**
   * Request subchunks around a position from the server.
   * Enables subchunk collection, sends request, and schedules
   * collection to stop after a timeout.
   */
  async requestSubchunks(
    client: Client,
    centerX: number, centerY: number, centerZ: number,
    radiusChunks: number, dimension: number
  ): Promise<void> {
    const c = client as any;

    const originCX = Math.floor(centerX) >> 4;
    const originCY = Math.floor(centerY) >> 4;
    const originCZ = Math.floor(centerZ) >> 4;

    const requests: { dx: number; dy: number; dz: number }[] = [];
    for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
      for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
        // Request 3 vertical subchunks around the bot's Y level
        for (let dy = -1; dy <= 1; dy++) {
          requests.push({ dx, dy, dz });
        }
      }
    }

    // Enable collection before sending request
    this.collectingSubchunks = true;

    c.queue('subchunk_request', {
      dimension,
      origin: { x: originCX, y: originCY, z: originCZ },
      requests,
    });

    // Auto-disable collection after 5 seconds to prevent lingering
    setTimeout(() => { this.collectingSubchunks = false; }, 5000);
  }

  /** Get count of loaded chunks. */
  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Get count of decoded subchunks across all chunks. */
  get decodedSubchunkCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) {
      count += chunk.decoded.size;
    }
    return count;
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private getDecodedSubchunk(chunk: StoredChunk, subY: number): DecodedSubChunk | null {
    // Check cache
    if (chunk.decoded.has(subY)) {
      return chunk.decoded.get(subY) ?? null;
    }

    // Try to decode from stored payload
    const payload = chunk.subchunks.get(subY);
    if (!payload) return null;

    const decoded = decodeSubChunkPayload(payload);
    chunk.decoded.set(subY, decoded);
    return decoded;
  }

  private pruneDistant(): void {
    // Keep max 500 chunks to limit memory
    if (this.chunks.size <= 500) return;

    // Remove oldest chunks
    const entries = [...this.chunks.entries()].sort(
      (a, b) => a[1].receivedAt - b[1].receivedAt
    );
    const toRemove = entries.length - 400;
    for (let i = 0; i < toRemove; i++) {
      this.chunks.delete(entries[i][0]);
    }
  }
}
