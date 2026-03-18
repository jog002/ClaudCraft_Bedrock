import { BotConnection, ChatEvent } from '../bot/connection';
import { WorldState } from '../bot/worldState';
import { LLMClient } from './client';
import { PromptBuilder } from './promptBuilder';
import { ActionDispatcher } from '../skills/actionDispatcher';
import { ActionResult, Goal } from '../skills/types';
import { Config } from '../config';
import { MemoryManager } from '../memory/memoryManager';

const MIN_CYCLE_INTERVAL_MS = 2000;
const MAX_RETRIES = 1;

export class AgentLoop {
  private connection: BotConnection;
  private worldState: WorldState;
  private llm: LLMClient;
  private promptBuilder: PromptBuilder;
  private dispatcher: ActionDispatcher;
  private config: Config;

  private memoryManager: MemoryManager;
  private currentGoal: Goal | null = null;
  private recentResults: ActionResult[] = [];
  private isProcessing = false;
  private decisionTimer: ReturnType<typeof setInterval> | null = null;
  private lastCycleTime = 0;
  private chatTrigger = false;
  private lastActivityTime = Date.now();
  private idleMode = false;
  private spawnLocationSaved = false;

  private readonly IDLE_THRESHOLD_MS = 30_000;
  private readonly IDLE_INTERVAL_MS = 15_000;

  constructor(
    connection: BotConnection,
    worldState: WorldState,
    llm: LLMClient,
    promptBuilder: PromptBuilder,
    config: Config,
    memoryManager: MemoryManager,
  ) {
    this.connection = connection;
    this.worldState = worldState;
    this.llm = llm;
    this.promptBuilder = promptBuilder;
    this.config = config;
    this.memoryManager = memoryManager;
    this.dispatcher = new ActionDispatcher({ connection, worldState }, config.connection.cheats, memoryManager, llm);

    // Wire death tracking
    this.worldState.setOnDeath((info) => {
      const cause = this.inferDeathCause();
      this.memoryManager.recordDeath(info.position, info.dimension, cause);
      this.memoryManager.addMemory(
        `Died at (${Math.floor(info.position.x)}, ${Math.floor(info.position.y)}, ${Math.floor(info.position.z)}) in ${info.dimension}: ${cause}`,
        'event'
      );
      console.log(`[AgentLoop] Death recorded: ${cause} at (${Math.floor(info.position.x)}, ${Math.floor(info.position.y)}, ${Math.floor(info.position.z)})`);
    });
  }

  start(): void {
    if (this.decisionTimer) return;
    console.log(`[AgentLoop] Started (interval: ${this.config.llm.decisionIntervalMs}ms)`);

    // Restore goal from memory if one was active
    const savedGoal = this.memoryManager.getActiveGoal();
    if (savedGoal) {
      this.currentGoal = { description: savedGoal.description, startedAt: savedGoal.createdAt };
      console.log(`[AgentLoop] Resumed goal from last session: "${savedGoal.description}"`);
    }

    // Save spawn point on first start
    if (!this.spawnLocationSaved) {
      this.spawnLocationSaved = true;
      const pos = this.worldState.bot.position;
      if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) {
        this.memoryManager.saveLocation('spawn_point', pos, 'Initial spawn location');
      }
    }

    this.decisionTimer = setInterval(() => {
      const now = Date.now();

      if (this.chatTrigger || this.currentGoal) {
        this.lastActivityTime = now;
        this.idleMode = false;
        this.runCycle();
      } else if (now - this.lastActivityTime > this.IDLE_THRESHOLD_MS) {
        // Enter idle mode — bot decides what to do on its own
        if (!this.idleMode) {
          console.log('[AgentLoop] Entering idle mode — bot will self-direct');
          this.idleMode = true;
        }
        // Run at slower cadence
        if (now - this.lastCycleTime > this.IDLE_INTERVAL_MS) {
          this.runCycle();
        }
      }
    }, this.config.llm.decisionIntervalMs);
  }

  stop(): void {
    if (this.decisionTimer) {
      clearInterval(this.decisionTimer);
      this.decisionTimer = null;
    }
  }

  onChatEvent(event: ChatEvent): void {
    const { username, message } = event;
    this.promptBuilder.addMessage(username, message);
    this.worldState.resolvePlayerName(username);

    // Update player in memory
    this.memoryManager.updatePlayer(username, { lastSeen: Date.now() });

    // Decide if we should respond
    if (!this.promptBuilder.shouldRespond(username, message)) return;

    this.chatTrigger = true;
    this.lastActivityTime = Date.now();
    this.idleMode = false;
    // Trigger immediate cycle (with rate limiting)
    this.runCycle();
  }

  private async runCycle(): Promise<void> {
    // Prevent concurrent cycles
    if (this.isProcessing) return;

    // Rate limit
    const now = Date.now();
    if (now - this.lastCycleTime < MIN_CYCLE_INTERVAL_MS) return;

    this.isProcessing = true;
    this.lastCycleTime = now;
    this.chatTrigger = false;

    try {
      await this.executeCycle();
    } catch (err: any) {
      console.error(`[AgentLoop] Cycle error: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeCycle(): Promise<void> {
    const systemPrompt = this.promptBuilder.getSystemPrompt();
    const worldContext = this.worldState.getWorldContext();
    const botStatus = this.idleMode
      ? 'Idle — no active tasks or conversations. Consider exploring, gathering resources, building, or pursuing a personal goal. Check your saved locations and memories for ideas.'
      : this.dispatcher.getStatus();

    // Build memory summary with context for relevance
    const nearbyPlayers = [...this.worldState.players.values()].map(p => p.username);
    const contextHint = this.currentGoal?.description ?? '';
    const memorySummary = this.memoryManager.getMemorySummary(
      this.worldState.bot.position,
      contextHint,
      nearbyPlayers,
    );

    const userMessage = this.promptBuilder.buildAgentPrompt(
      worldContext,
      this.recentResults.length > 0 ? this.recentResults : undefined,
      this.currentGoal,
      botStatus,
      memorySummary,
    );

    // Try to get actions from LLM
    let result = await this.llm.getActions(systemPrompt, userMessage);

    // Retry on failure
    for (let retry = 0; retry < MAX_RETRIES && 'error' in result; retry++) {
      console.warn(`[AgentLoop] LLM error (retry ${retry + 1}): ${result.error}`);
      result = await this.llm.getActions(systemPrompt, userMessage);
    }

    if ('error' in result) {
      console.error(`[AgentLoop] Failed to get actions: ${result.error}`);
      this.recentResults = [];
      return;
    }

    const request = result.parsed;

    // Update goal with persistence
    if (request.goalComplete && this.currentGoal) {
      console.log(`[AgentLoop] Goal completed: ${this.currentGoal.description}`);
      this.memoryManager.completeGoal();
      this.memoryManager.addMemory(`Completed goal: ${this.currentGoal.description}`, 'event');
      this.currentGoal = null;
    }
    if (request.goal) {
      this.currentGoal = { description: request.goal, startedAt: Date.now() };
      this.memoryManager.pushGoal(request.goal);
      console.log(`[AgentLoop] New goal: ${request.goal}`);
    }

    // Dispatch actions
    const results = await this.dispatcher.dispatch(request);

    // Add bot's own chat messages to history
    for (const action of request.actions) {
      if (action.type === 'chat') {
        this.promptBuilder.addMessage(this.config.bot.name, action.message);
      }
    }

    // Store results for next cycle
    this.recentResults = results;
  }

  /** Infer death cause from nearby entities and world state. */
  private inferDeathCause(): string {
    const nearbyHostiles = [...this.worldState.entities.values()]
      .filter(e => e.category === 'hostile')
      .map(e => ({
        name: e.displayName,
        dist: Math.sqrt(
          (e.position.x - this.worldState.bot.position.x) ** 2 +
          (e.position.y - this.worldState.bot.position.y) ** 2 +
          (e.position.z - this.worldState.bot.position.z) ** 2
        ),
      }))
      .sort((a, b) => a.dist - b.dist);

    if (nearbyHostiles.length > 0 && nearbyHostiles[0].dist < 8) {
      return `killed by ${nearbyHostiles[0].name}`;
    }

    if (this.worldState.bot.position.y < -60) {
      return 'fell into the void';
    }

    // Check for lava nearby
    const notableBlocks = this.worldState.getNearbyNotableBlocks(4);
    if (notableBlocks.some(b => b.name.includes('lava'))) {
      return 'burned in lava';
    }

    return 'unknown cause';
  }
}
