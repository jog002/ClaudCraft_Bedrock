import { describe, it, expect } from 'vitest';
import {
  decodeSubChunkPayload,
  localToIndex, indexToLocal,
  worldToChunk, worldToSubChunk,
} from '../../src/world/chunkDecoder';

describe('chunkDecoder', () => {
  describe('coordinate helpers', () => {
    it('localToIndex and indexToLocal round-trip', () => {
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          for (let y = 0; y < 16; y++) {
            const idx = localToIndex(x, y, z);
            const result = indexToLocal(idx);
            expect(result).toEqual({ x, y, z });
          }
        }
      }
    });

    it('localToIndex matches expected formula y | (z << 4) | (x << 8)', () => {
      expect(localToIndex(0, 0, 0)).toBe(0);
      expect(localToIndex(0, 1, 0)).toBe(1);
      expect(localToIndex(0, 0, 1)).toBe(16);
      expect(localToIndex(1, 0, 0)).toBe(256);
      expect(localToIndex(15, 15, 15)).toBe(0xfff);
    });

    it('worldToChunk converts correctly', () => {
      expect(worldToChunk(0, 0)).toEqual({ cx: 0, cz: 0 });
      expect(worldToChunk(16, 16)).toEqual({ cx: 1, cz: 1 });
      expect(worldToChunk(-1, -1)).toEqual({ cx: -1, cz: -1 });
      expect(worldToChunk(15, 15)).toEqual({ cx: 0, cz: 0 });
      expect(worldToChunk(31, 31)).toEqual({ cx: 1, cz: 1 });
    });

    it('worldToSubChunk converts correctly', () => {
      expect(worldToSubChunk(0, 0, 0)).toEqual({ cx: 0, cy: 0, cz: 0 });
      expect(worldToSubChunk(0, 64, 0)).toEqual({ cx: 0, cy: 4, cz: 0 });
      expect(worldToSubChunk(0, -64, 0)).toEqual({ cx: 0, cy: -4, cz: 0 });
    });
  });

  describe('decodeSubChunkPayload', () => {
    it('returns null for empty buffer', () => {
      expect(decodeSubChunkPayload(Buffer.alloc(0))).toBeNull();
    });

    it('returns null for legacy format (version 0)', () => {
      const buf = Buffer.alloc(4096 + 2048 + 1);
      buf[0] = 0; // version 0
      expect(decodeSubChunkPayload(buf)).toBeNull();
    });

    it('decodes a version 8 subchunk with 1-bit palette (2 block types)', () => {
      // Build a minimal v8 subchunk:
      // version=8, numStorages=1, flags=(1bpb << 1 | runtime=1) = 3
      // 1 bit per block, 32 blocks per word, 128 words for 4096 blocks
      // palette: 2 entries (air=0, stone=1)
      const parts: number[] = [];
      parts.push(8);  // version
      parts.push(1);  // num_storages

      // Flags: bitsPerBlock=1, runtime=1 → (1 << 1) | 1 = 3
      parts.push(3);

      // Word data: 128 words × 4 bytes = 512 bytes
      // Fill all blocks with palette index 1 (all bits set)
      const wordBuf = Buffer.alloc(128 * 4);
      for (let i = 0; i < 128; i++) {
        wordBuf.writeUInt32LE(0xffffffff, i * 4); // all 1s = palette index 1
      }

      // Palette: 2 entries as signed varints
      // Entry 0: runtime_id = 0 (air)
      // Entry 1: runtime_id = 1 (stone)
      // Varint for signed 0 = zigzag(0) = 0
      // Varint for signed 1 = zigzag(1) = 2
      // But palette size first as signed varint: zigzag(2) = 4
      const paletteBuf = Buffer.from([4, 0, 2]); // size=2, id=0, id=1

      const payload = Buffer.concat([
        Buffer.from(parts),
        wordBuf,
        paletteBuf,
      ]);

      const result = decodeSubChunkPayload(payload);
      expect(result).not.toBeNull();
      expect(result!.palette).toEqual([0, 1]);
      expect(result!.blockIds.length).toBe(4096);
      // All blocks should be runtime ID 1
      for (let i = 0; i < 4096; i++) {
        expect(result!.blockIds[i]).toBe(1);
      }
    });

    it('decodes a version 9 subchunk with subchunk index', () => {
      // version=9, numStorages=1, subchunkIndex=5
      // Same 1-bit palette as above but all zeros (air)
      const parts: number[] = [];
      parts.push(9);  // version
      parts.push(1);  // num_storages
      parts.push(5);  // subchunk_index

      // Flags: bitsPerBlock=1, runtime=1 → 3
      parts.push(3);

      // Word data: all zeros (all palette index 0)
      const wordBuf = Buffer.alloc(128 * 4);

      // Palette: 1 entry (just air)
      // Size as signed varint: zigzag(1) = 2
      // Entry: runtime_id=0 → zigzag(0) = 0
      const paletteBuf = Buffer.from([2, 0]); // size=1, id=0

      const payload = Buffer.concat([
        Buffer.from(parts),
        wordBuf,
        paletteBuf,
      ]);

      const result = decodeSubChunkPayload(payload);
      expect(result).not.toBeNull();
      expect(result!.palette).toEqual([0]);
      // All blocks should be runtime ID 0 (air)
      for (let i = 0; i < 4096; i++) {
        expect(result!.blockIds[i]).toBe(0);
      }
    });

    it('decodes 4-bit palette correctly', () => {
      // version=8, numStorages=1
      // 4 bits per block, 8 blocks per word, 512 words
      const parts: number[] = [];
      parts.push(8);  // version
      parts.push(1);  // num_storages

      // Flags: bitsPerBlock=4, runtime=1 → (4 << 1) | 1 = 9
      parts.push(9);

      // Word data: 512 words
      // Set pattern: first word = 0x76543210 (blocks 0-7 get palette indices 0,1,2,3,4,5,6,7)
      const wordBuf = Buffer.alloc(512 * 4);
      // First word: each 4-bit nibble is a palette index
      wordBuf.writeUInt32LE(0x76543210, 0);
      // Rest are zeros

      // Palette: 16 entries
      // Size as signed varint: zigzag(16) = 32
      const paletteEntries = [32]; // size=16
      for (let i = 0; i < 16; i++) {
        // zigzag encode: (i << 1) ^ (i >> 31)
        // For small positive i: just i * 2
        paletteEntries.push(i * 2);
      }
      const paletteBuf = Buffer.from(paletteEntries);

      const payload = Buffer.concat([
        Buffer.from(parts),
        wordBuf,
        paletteBuf,
      ]);

      const result = decodeSubChunkPayload(payload);
      expect(result).not.toBeNull();
      expect(result!.palette.length).toBe(16);
      // First 8 blocks should match palette indices 0-7
      expect(result!.blockIds[0]).toBe(0);
      expect(result!.blockIds[1]).toBe(1);
      expect(result!.blockIds[2]).toBe(2);
      expect(result!.blockIds[3]).toBe(3);
      expect(result!.blockIds[4]).toBe(4);
      expect(result!.blockIds[5]).toBe(5);
      expect(result!.blockIds[6]).toBe(6);
      expect(result!.blockIds[7]).toBe(7);
    });
  });
});
