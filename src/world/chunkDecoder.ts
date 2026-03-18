/**
 * Bedrock Edition subchunk payload decoder.
 *
 * Parses the palette-encoded block storage format used in level_chunk and
 * subchunk packets.  Each subchunk is 16×16×16 blocks.
 *
 * Format reference:
 *   https://minecraft.wiki/w/Bedrock_Edition_level_format
 *
 * Supports version 1, 8, and 9 subchunk formats.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface DecodedSubChunk {
  /** 4096 runtime block IDs indexed by y | (z << 4) | (x << 8) */
  blockIds: Int32Array;
  /** Palette: index → runtime block ID */
  palette: number[];
}

export interface BlockPos {
  x: number;
  y: number;
  z: number;
}

// Blocks per 32-bit word for each valid bits-per-block value
const BLOCKS_PER_WORD: Record<number, number> = {
  1: 32, 2: 16, 3: 10, 4: 8, 5: 6, 6: 5, 8: 4, 16: 2,
};

// ─── Varint Reader ──────────────────────────────────────────────────────

class BinaryReader {
  private buf: Buffer;
  private offset: number;

  constructor(buf: Buffer, offset = 0) {
    this.buf = buf;
    this.offset = offset;
  }

  get pos(): number { return this.offset; }
  get remaining(): number { return this.buf.length - this.offset; }

  readByte(): number {
    if (this.offset >= this.buf.length) throw new Error('BinaryReader: unexpected end of buffer');
    return this.buf[this.offset++];
  }

  readInt32LE(): number {
    if (this.offset + 4 > this.buf.length) throw new Error('BinaryReader: unexpected end of buffer');
    const val = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return val;
  }

  readUInt32LE(): number {
    if (this.offset + 4 > this.buf.length) throw new Error('BinaryReader: unexpected end of buffer');
    const val = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return val;
  }

  /** Read a signed varint (zigzag-decoded). */
  readVarint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.readByte();
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    // Zigzag decode for signed
    return (result >>> 1) ^ -(result & 1);
  }

  /** Read an unsigned varint (no zigzag). */
  readUnsignedVarint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.readByte();
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  }
}

// ─── Block Storage Layer Decoder ────────────────────────────────────────

function decodeBlockStorageLayer(reader: BinaryReader): { blockIds: Int32Array; palette: number[] } {
  const flags = reader.readByte();
  const bitsPerBlock = flags >> 1;
  const isRuntime = (flags & 1) !== 0;

  // Special case: 0 bits per block means single-block palette
  if (bitsPerBlock === 0) {
    const paletteSize = isRuntime ? reader.readVarint() : reader.readInt32LE();
    const palette: number[] = [];
    for (let i = 0; i < paletteSize; i++) {
      palette.push(isRuntime ? reader.readVarint() : reader.readInt32LE());
    }
    // All blocks are palette index 0
    const blockIds = new Int32Array(4096);
    if (palette.length > 0) blockIds.fill(palette[0]);
    return { blockIds, palette };
  }

  const blocksPerWord = BLOCKS_PER_WORD[bitsPerBlock];
  if (!blocksPerWord) {
    throw new Error(`Unsupported bits-per-block: ${bitsPerBlock}`);
  }

  // Read word data
  const wordCount = Math.ceil(4096 / blocksPerWord);
  const words = new Uint32Array(wordCount);
  for (let i = 0; i < wordCount; i++) {
    words[i] = reader.readUInt32LE();
  }

  // Read palette
  const paletteSize = isRuntime ? reader.readVarint() : reader.readInt32LE();
  const palette: number[] = [];
  for (let i = 0; i < paletteSize; i++) {
    if (isRuntime) {
      palette.push(reader.readVarint());
    } else {
      // Persistence format: NBT compound tag — skip for now (we use runtime format)
      palette.push(reader.readInt32LE());
    }
  }

  // Unpack block indices from words
  const blockIds = new Int32Array(4096);
  const mask = (1 << bitsPerBlock) - 1;
  let blockIndex = 0;

  for (let w = 0; w < wordCount && blockIndex < 4096; w++) {
    const word = words[w];
    for (let b = 0; b < blocksPerWord && blockIndex < 4096; b++) {
      const paletteIdx = (word >> (b * bitsPerBlock)) & mask;
      blockIds[blockIndex] = paletteIdx < palette.length ? palette[paletteIdx] : 0;
      blockIndex++;
    }
  }

  return { blockIds, palette };
}

// ─── Subchunk Payload Decoder ───────────────────────────────────────────

/**
 * Decode a subchunk payload buffer into block runtime IDs.
 *
 * Returns the primary block storage layer (terrain).
 * The secondary layer (liquids/snow) is skipped.
 */
export function decodeSubChunkPayload(payload: Buffer): DecodedSubChunk | null {
  if (!payload || payload.length === 0) return null;

  const reader = new BinaryReader(payload);
  const version = reader.readByte();

  if (version === 0 || (version >= 2 && version <= 7)) {
    // Legacy format — 4096 bytes of block IDs + 2048 bytes of metadata
    // Not worth supporting for modern servers
    return null;
  }

  let numStorages = 1;

  if (version === 8 || version === 9) {
    numStorages = reader.readByte();
    if (version === 9) {
      reader.readByte(); // subchunk index — skip
    }
  }
  // version 1: single storage, no header beyond version byte

  if (numStorages === 0) return null;

  try {
    // Decode primary layer (terrain blocks)
    const primary = decodeBlockStorageLayer(reader);
    // Skip remaining layers (liquids/snow) — we don't need them
    return {
      blockIds: primary.blockIds,
      palette: primary.palette,
    };
  } catch (err: any) {
    console.error(`[ChunkDecoder] Failed to decode subchunk (version=${version}): ${err.message}`);
    return null;
  }
}

// ─── Coordinate Helpers ─────────────────────────────────────────────────

/**
 * Convert local subchunk coords (0-15 each) to a block index.
 * Index ordering: y | (z << 4) | (x << 8)
 */
export function localToIndex(x: number, y: number, z: number): number {
  return y | (z << 4) | (x << 8);
}

/**
 * Convert block index back to local subchunk coords.
 */
export function indexToLocal(index: number): { x: number; y: number; z: number } {
  return {
    y: index & 0xf,
    z: (index >> 4) & 0xf,
    x: (index >> 8) & 0xf,
  };
}

/**
 * Convert world coordinates to chunk coordinates.
 */
export function worldToChunk(x: number, z: number): { cx: number; cz: number } {
  return {
    cx: Math.floor(x) >> 4,
    cz: Math.floor(z) >> 4,
  };
}

/**
 * Convert world coordinates to subchunk coordinates.
 */
export function worldToSubChunk(x: number, y: number, z: number): { cx: number; cy: number; cz: number } {
  return {
    cx: Math.floor(x) >> 4,
    cy: Math.floor(y) >> 4,
    cz: Math.floor(z) >> 4,
  };
}
