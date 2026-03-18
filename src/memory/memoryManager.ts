/**
 * MemoryManager — persistent bot memory backed by a JSON file.
 *
 * Stores: free-text memories, named locations, death records,
 * player profiles, goal stack, and skill library.
 * Debounced saves (10s) with sync save on shutdown.
 */
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ──────────────────────────────────────────────────────────────

export interface MemoryEntry {
  text: string;
  timestamp: number;
  category: 'observation' | 'lesson' | 'event' | 'relationship';
}

export interface DeathRecord {
  position: { x: number; y: number; z: number };
  dimension: string;
  cause: string;
  timestamp: number;
}

export interface PlayerProfile {
  firstSeen: number;
  lastSeen: number;
  trustLevel: 'unknown' | 'friendly' | 'trusted' | 'owner';
  notes: string[];
}

export interface PersistedGoal {
  description: string;
  priority: number;
  createdAt: number;
  subGoals?: string[];
  status: 'active' | 'paused' | 'completed';
}

export interface SavedSkill {
  description: string;
  steps: string;
  timesUsed: number;
  lastUsed: number;
}

export interface BotMemory {
  memories: MemoryEntry[];
  knownLocations: Record<string, { x: number; y: number; z: number; note?: string }>;
  deaths: DeathRecord[];
  players: Record<string, PlayerProfile>;
  goalStack: PersistedGoal[];
  skillLibrary: Record<string, SavedSkill>;
  lastSaved: number;
  totalSessions: number;
}

// ─── Caps ───────────────────────────────────────────────────────────────

const MAX_MEMORIES = 200;
const MAX_DEATHS = 50;
const MAX_PLAYER_NOTES = 20;
const SAVE_DEBOUNCE_MS = 10_000;

// ─── Default Memory ─────────────────────────────────────────────────────

function createDefaultMemory(): BotMemory {
  return {
    memories: [],
    knownLocations: {},
    deaths: [],
    players: {},
    goalStack: [],
    skillLibrary: {},
    lastSaved: Date.now(),
    totalSessions: 0,
  };
}

// ─── MemoryManager ──────────────────────────────────────────────────────

export class MemoryManager {
  private data: BotMemory;
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = createDefaultMemory();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        // Merge over defaults to handle schema additions gracefully
        this.data = { ...createDefaultMemory(), ...parsed };
        console.log(`[Memory] Loaded ${this.data.memories.length} memories, ${Object.keys(this.data.knownLocations).length} locations, ${this.data.deaths.length} deaths`);
      } else {
        console.log('[Memory] No existing memory file, starting fresh');
      }
    } catch (err: any) {
      console.error(`[Memory] Failed to load: ${err.message}, starting fresh`);
      this.data = createDefaultMemory();
    }
    this.data.totalSessions++;
    this.markDirty();
  }

  save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.data.lastSaved = Date.now();
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
      this.dirty = false;
    } catch (err: any) {
      console.error(`[Memory] Failed to save: ${err.message}`);
    }
  }

  /** Call on process shutdown — saves synchronously. */
  shutdown(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      this.save();
      console.log('[Memory] Saved on shutdown');
    }
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer) return; // already scheduled
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  // ─── Memories ───────────────────────────────────────────────────────

  addMemory(text: string, category: MemoryEntry['category'] = 'observation'): void {
    this.data.memories.push({ text, timestamp: Date.now(), category });
    // Prune if over cap — remove oldest observations first
    while (this.data.memories.length > MAX_MEMORIES) {
      const obsIdx = this.data.memories.findIndex(m => m.category === 'observation');
      if (obsIdx >= 0) {
        this.data.memories.splice(obsIdx, 1);
      } else {
        this.data.memories.shift(); // remove oldest regardless
      }
    }
    this.markDirty();
  }

  getRecentMemories(count: number): MemoryEntry[] {
    return this.data.memories.slice(-count);
  }

  /** Search memories by keyword (case-insensitive). Returns most recent matches first. */
  getRelevantMemories(query: string, count: number = 10): MemoryEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return this.getRecentMemories(count);

    const scored = this.data.memories
      .map(m => {
        const lower = m.text.toLowerCase();
        const score = words.filter(w => lower.includes(w)).length;
        return { memory: m, score };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score || b.memory.timestamp - a.memory.timestamp);

    return scored.slice(0, count).map(s => s.memory);
  }

  getAllMemories(): MemoryEntry[] {
    return [...this.data.memories];
  }

  // ─── Locations ──────────────────────────────────────────────────────

  saveLocation(name: string, pos: { x: number; y: number; z: number }, note?: string): void {
    this.data.knownLocations[name.toLowerCase()] = {
      x: Math.floor(pos.x),
      y: Math.floor(pos.y),
      z: Math.floor(pos.z),
      note,
    };
    this.markDirty();
  }

  getLocation(name: string): { x: number; y: number; z: number; note?: string } | null {
    return this.data.knownLocations[name.toLowerCase()] ?? null;
  }

  getAllLocations(): Record<string, { x: number; y: number; z: number; note?: string }> {
    return { ...this.data.knownLocations };
  }

  // ─── Deaths ─────────────────────────────────────────────────────────

  recordDeath(pos: { x: number; y: number; z: number }, dimension: string, cause: string): void {
    this.data.deaths.push({
      position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
      dimension,
      cause,
      timestamp: Date.now(),
    });
    // Cap deaths
    while (this.data.deaths.length > MAX_DEATHS) {
      this.data.deaths.shift();
    }
    // Auto-save death location
    const deathNum = this.data.deaths.length;
    this.saveLocation(`death_${deathNum}`, pos, `Died: ${cause}`);
    this.markDirty();
  }

  getRecentDeaths(count: number): DeathRecord[] {
    return this.data.deaths.slice(-count);
  }

  getDeathsNear(pos: { x: number; y: number; z: number }, radius: number): DeathRecord[] {
    return this.data.deaths.filter(d => {
      const dist = Math.sqrt(
        (d.position.x - pos.x) ** 2 +
        (d.position.y - pos.y) ** 2 +
        (d.position.z - pos.z) ** 2
      );
      return dist <= radius;
    });
  }

  // ─── Players ────────────────────────────────────────────────────────

  updatePlayer(name: string, update: Partial<PlayerProfile>): void {
    const key = name.toLowerCase();
    const existing = this.data.players[key] ?? {
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      trustLevel: 'unknown' as const,
      notes: [],
    };
    this.data.players[key] = { ...existing, ...update, lastSeen: Date.now() };
    this.markDirty();
  }

  getPlayer(name: string): PlayerProfile | null {
    return this.data.players[name.toLowerCase()] ?? null;
  }

  addPlayerNote(name: string, note: string): void {
    const key = name.toLowerCase();
    if (!this.data.players[key]) {
      this.data.players[key] = {
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        trustLevel: 'unknown',
        notes: [],
      };
    }
    const player = this.data.players[key];
    player.notes.push(note);
    // Cap notes per player
    while (player.notes.length > MAX_PLAYER_NOTES) {
      player.notes.shift();
    }
    player.lastSeen = Date.now();
    this.markDirty();
  }

  // ─── Goals ──────────────────────────────────────────────────────────

  pushGoal(description: string, priority: number = 1, subGoals?: string[]): void {
    // Pause current active goal if any
    for (const g of this.data.goalStack) {
      if (g.status === 'active') g.status = 'paused';
    }
    this.data.goalStack.push({
      description,
      priority,
      createdAt: Date.now(),
      subGoals,
      status: 'active',
    });
    this.markDirty();
  }

  getActiveGoal(): PersistedGoal | null {
    for (let i = this.data.goalStack.length - 1; i >= 0; i--) {
      if (this.data.goalStack[i].status === 'active') {
        return this.data.goalStack[i];
      }
    }
    return null;
  }

  completeGoal(): void {
    // Mark the active goal as completed
    for (let i = this.data.goalStack.length - 1; i >= 0; i--) {
      if (this.data.goalStack[i].status === 'active') {
        this.data.goalStack[i].status = 'completed';
        break;
      }
    }
    // Resume the most recent paused goal
    for (let i = this.data.goalStack.length - 1; i >= 0; i--) {
      if (this.data.goalStack[i].status === 'paused') {
        this.data.goalStack[i].status = 'active';
        break;
      }
    }
    // Prune completed goals (keep last 20)
    const completed = this.data.goalStack.filter(g => g.status === 'completed');
    if (completed.length > 20) {
      this.data.goalStack = this.data.goalStack.filter(g => g.status !== 'completed')
        .concat(completed.slice(-20));
    }
    this.markDirty();
  }

  getGoalStack(): PersistedGoal[] {
    return [...this.data.goalStack];
  }

  // ─── Skills ─────────────────────────────────────────────────────────

  saveSkill(name: string, description: string, steps: string): void {
    const key = name.toLowerCase();
    const existing = this.data.skillLibrary[key];
    this.data.skillLibrary[key] = {
      description,
      steps,
      timesUsed: existing ? existing.timesUsed + 1 : 0,
      lastUsed: Date.now(),
    };
    this.markDirty();
  }

  getSkill(name: string): SavedSkill | null {
    return this.data.skillLibrary[name.toLowerCase()] ?? null;
  }

  getAllSkillNames(): string[] {
    return Object.keys(this.data.skillLibrary);
  }

  // ─── Prompt Summary ─────────────────────────────────────────────────

  /**
   * Generate a formatted memory summary for injection into the LLM prompt.
   * Accepts optional context for relevance-based filtering.
   */
  getMemorySummary(
    botPos?: { x: number; y: number; z: number },
    context?: string,
    nearbyPlayers?: string[],
  ): string {
    const lines: string[] = [];

    // Memories: recent + relevant
    const recent = this.getRecentMemories(10);
    const relevant = context ? this.getRelevantMemories(context, 5) : [];
    const allMemories = dedupeMemories([...relevant, ...recent]).slice(0, 15);

    if (allMemories.length > 0) {
      lines.push('MEMORIES:');
      for (const m of allMemories) {
        const age = formatAge(m.timestamp);
        lines.push(`- [${m.category}] ${m.text} (${age})`);
      }
    }

    // Known locations
    const locs = this.getAllLocations();
    const locKeys = Object.keys(locs);
    if (locKeys.length > 0) {
      lines.push('');
      lines.push('KNOWN LOCATIONS:');
      for (const name of locKeys) {
        const loc = locs[name];
        const noteStr = loc.note ? ` — ${loc.note}` : '';
        lines.push(`- ${name}: (${loc.x}, ${loc.y}, ${loc.z})${noteStr}`);
      }
    }

    // Deaths: recent + nearby
    const recentDeaths = this.getRecentDeaths(3);
    const nearbyDeaths = botPos ? this.getDeathsNear(botPos, 32) : [];
    const allDeaths = dedupeDeaths([...nearbyDeaths, ...recentDeaths]).slice(0, 5);

    if (allDeaths.length > 0) {
      lines.push('');
      lines.push('RECENT DEATHS:');
      for (const d of allDeaths) {
        const age = formatAge(d.timestamp);
        lines.push(`- Died at (${d.position.x}, ${d.position.y}, ${d.position.z}) in ${d.dimension} — ${d.cause} (${age})`);
      }
    }

    // Player notes for nearby players
    if (nearbyPlayers && nearbyPlayers.length > 0) {
      const playerLines: string[] = [];
      for (const name of nearbyPlayers) {
        const profile = this.getPlayer(name);
        if (profile && profile.notes.length > 0) {
          const recentNotes = profile.notes.slice(-3).join('; ');
          playerLines.push(`- ${name} [${profile.trustLevel}]: ${recentNotes}`);
        }
      }
      if (playerLines.length > 0) {
        lines.push('');
        lines.push('PLAYER NOTES:');
        lines.push(...playerLines);
      }
    }

    // Skill library (names only)
    const skills = this.getAllSkillNames();
    if (skills.length > 0) {
      lines.push('');
      lines.push(`SAVED SKILLS: ${skills.join(', ')}`);
    }

    // Truncate to ~1500 chars
    let result = lines.join('\n');
    if (result.length > 1500) {
      result = result.substring(0, 1497) + '...';
    }
    return result;
  }

  // ─── Test Helpers ───────────────────────────────────────────────────

  /** Get raw data (for testing). */
  getRawData(): BotMemory {
    return this.data;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatAge(timestamp: number): string {
  const ms = Date.now() - timestamp;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function dedupeMemories(memories: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  return memories.filter(m => {
    const key = m.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeDeaths(deaths: DeathRecord[]): DeathRecord[] {
  const seen = new Set<string>();
  return deaths.filter(d => {
    const key = `${d.position.x},${d.position.y},${d.position.z},${d.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
