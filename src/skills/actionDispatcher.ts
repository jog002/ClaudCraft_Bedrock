import { Action, ActionRequest, ActionResult, SkillContext } from './types';
import { executeChat } from './chat';
import { executeNavigateTo, executeNavigateToPlayer } from './navigate';
import { executeFollowPlayer, executeStopFollowing, isFollowing, getFollowTarget } from './follow';
import { executeLookAtPlayer } from './look';
import { executeCommand, executeAttack } from './command';
import { executeWait } from './wait';
import {
  executeGiveItem, executePlaceBlock, executeBreakBlock, executeFillBlocks,
  executeSummon, executeSetTime, executeWeather, executeEffect,
  executeEnchant, executeClearInventory, executeTeleportEntity, executeGamemode,
} from './world';
import {
  executeSurvivalWalkTo, executeSurvivalWalkToPlayer,
  executeSurvivalFollowPlayer, executeSurvivalStopFollowing,
  isSurvivalFollowing, getSurvivalFollowTarget, cancelWalk,
  executeSurvivalAttack,
  executeSurvivalMineBlock, executeSurvivalPlaceBlock,
  executeSurvivalJump, executeSurvivalSneak, executeSurvivalSprint,
  executeSurvivalDropItem,
} from './survival';
import { executeCheatEquipItem, executeSurvivalEquipItem, executeCheatEquipArmor, executeSurvivalEquipArmor } from './equip';
import { executeCheatCollectDrops, executeSurvivalCollectDrops } from './collect';
import { executeCheatCraft, executeSurvivalCraft } from './craft';
import {
  executeCheatOpenContainer, executeSurvivalOpenContainer,
  executeCloseContainer,
  executeCheatStoreItem, executeSurvivalStoreItem,
  executeCheatRetrieveItem, executeSurvivalRetrieveItem,
} from './container';
import {
  executeCheatEatFood, executeSurvivalEatFood,
  executeCheatSleepInBed, executeSurvivalSleepInBed,
} from './interact';
import { executeScanNearby, executeDeepScan } from './scan';
import {
  executeRememberLocation, executeGoToLocation,
  executeAddMemory, executeRecallMemories,
  executeSaveSkill, executeAddPlayerNote,
  executeThink,
} from './memory';
import { MemoryManager } from '../memory/memoryManager';
import { LLMClient } from '../llm/client';

export class ActionDispatcher {
  private ctx: SkillContext;
  private cheatsEnabled: boolean;
  private memoryManager: MemoryManager;
  private llmClient?: LLMClient;

  constructor(ctx: SkillContext, cheatsEnabled = true, memoryManager?: MemoryManager, llmClient?: LLMClient) {
    this.ctx = ctx;
    this.cheatsEnabled = cheatsEnabled;
    this.memoryManager = memoryManager ?? new MemoryManager('./memory/bot_memory.json');
    this.llmClient = llmClient;
  }

  async dispatch(request: ActionRequest): Promise<ActionResult[]> {
    console.log(`[ActionDispatcher] Thought: ${request.thought}`);
    console.log(`[ActionDispatcher] Actions: ${request.actions.map((a) => a.type).join(', ')}`);

    const results: ActionResult[] = [];

    for (const action of request.actions) {
      try {
        const result = await this.executeAction(action);
        results.push(result);
        console.log(`[ActionDispatcher] ${action.type}: ${result.success ? 'OK' : 'FAIL'} — ${result.message}`);
      } catch (err: any) {
        const result: ActionResult = {
          success: false,
          message: `Error: ${err.message}`,
          actionType: action.type,
        };
        results.push(result);
        console.error(`[ActionDispatcher] ${action.type} threw: ${err.message}`);
      }
    }

    return results;
  }

  private async executeAction(action: Action): Promise<ActionResult> {
    if (this.cheatsEnabled) {
      return this.executeCheatAction(action);
    } else {
      return this.executeSurvivalAction(action);
    }
  }

  // ─── Cheat mode: uses slash commands ─────────────────────────────────

  private async executeCheatAction(action: Action): Promise<ActionResult> {
    // Cancel follow if starting a movement action
    if (
      isFollowing() &&
      (action.type === 'navigateTo' || action.type === 'navigateToPlayer' || action.type === 'followPlayer')
    ) {
      await executeStopFollowing();
    }

    switch (action.type) {
      case 'chat':
        return executeChat(action, this.ctx);
      case 'navigateTo':
        return executeNavigateTo(action, this.ctx);
      case 'navigateToPlayer':
        return executeNavigateToPlayer(action, this.ctx);
      case 'followPlayer':
        return executeFollowPlayer(action, this.ctx);
      case 'stopFollowing':
        return executeStopFollowing();
      case 'lookAtPlayer':
        return executeLookAtPlayer(action, this.ctx);
      case 'attack':
        return executeAttack(action, this.ctx);
      case 'command':
        return executeCommand(action, this.ctx);
      case 'wait':
        return executeWait(action);
      case 'giveItem':
        return executeGiveItem(action, this.ctx);
      case 'placeBlock':
        return executePlaceBlock(action, this.ctx);
      case 'breakBlock':
        return executeBreakBlock(action, this.ctx);
      case 'fillBlocks':
        return executeFillBlocks(action, this.ctx);
      case 'summon':
        return executeSummon(action, this.ctx);
      case 'setTime':
        return executeSetTime(action, this.ctx);
      case 'weather':
        return executeWeather(action, this.ctx);
      case 'effect':
        return executeEffect(action, this.ctx);
      case 'enchant':
        return executeEnchant(action, this.ctx);
      case 'clearInventory':
        return executeClearInventory(action, this.ctx);
      case 'teleportEntity':
        return executeTeleportEntity(action, this.ctx);
      case 'gamemode':
        return executeGamemode(action, this.ctx);
      // Stage 5: mining, building, crafting
      case 'equipItem':
        return executeCheatEquipItem(action, this.ctx);
      case 'equipArmor':
        return executeCheatEquipArmor(action, this.ctx);
      case 'collectDrops':
        return executeCheatCollectDrops(action, this.ctx);
      case 'craft':
        return executeCheatCraft(action, this.ctx);
      case 'openContainer':
        return executeCheatOpenContainer(action, this.ctx);
      case 'closeContainer':
        return executeCloseContainer(action, this.ctx);
      case 'storeItem':
        return executeCheatStoreItem(action, this.ctx);
      case 'retrieveItem':
        return executeCheatRetrieveItem(action, this.ctx);
      case 'eatFood':
        return executeCheatEatFood(action, this.ctx);
      case 'sleepInBed':
        return executeCheatSleepInBed(action, this.ctx);
      case 'scanNearby':
        return executeScanNearby(action, this.ctx);
      case 'deepScan':
        return executeDeepScan(action, this.ctx);
      // Memory actions (shared across modes)
      case 'rememberLocation':
        return executeRememberLocation(action, this.ctx, this.memoryManager);
      case 'goToLocation':
        return executeGoToLocation(action, this.ctx, this.memoryManager, true);
      case 'addMemory':
        return executeAddMemory(action, this.memoryManager);
      case 'recallMemories':
        return executeRecallMemories(action, this.memoryManager);
      case 'saveSkill':
        return executeSaveSkill(action, this.memoryManager);
      case 'addPlayerNote':
        return executeAddPlayerNote(action, this.memoryManager);
      case 'think':
        if (!this.llmClient) return { success: false, message: 'Reasoning model not available', actionType: 'think' };
        return executeThink(action, this.ctx, this.memoryManager, this.llmClient);
      default:
        return { success: false, message: `Unknown action type: ${(action as any).type}`, actionType: 'unknown' };
    }
  }

  // ─── Survival mode: uses raw packets ─────────────────────────────────

  private async executeSurvivalAction(action: Action): Promise<ActionResult> {
    // Cancel survival follow/walk if starting a movement action
    const movementActions = ['walkTo', 'walkToPlayer', 'followPlayer', 'navigateTo', 'navigateToPlayer'];
    if (isSurvivalFollowing() && movementActions.includes(action.type)) {
      await executeSurvivalStopFollowing();
      cancelWalk();
    }

    switch (action.type) {
      // Shared (work in both modes)
      case 'chat':
        return executeChat(action, this.ctx);
      case 'lookAtPlayer':
        return executeLookAtPlayer(action, this.ctx);
      case 'wait':
        return executeWait(action);

      // Survival movement
      case 'walkTo':
        return executeSurvivalWalkTo(action, this.ctx);
      case 'walkToPlayer':
        return executeSurvivalWalkToPlayer(action, this.ctx);
      case 'followPlayer':
        return executeSurvivalFollowPlayer(action, this.ctx);
      case 'stopFollowing':
        return executeSurvivalStopFollowing();

      // Survival combat
      case 'attack':
        return executeSurvivalAttack(action, this.ctx);

      // Survival building
      case 'placeBlock':
        return executeSurvivalPlaceBlock(action, this.ctx);
      case 'breakBlock':
        return executeSurvivalMineBlock(action, this.ctx);

      // Survival actions
      case 'jump':
        return executeSurvivalJump(action, this.ctx);
      case 'sneak':
        return executeSurvivalSneak(action, this.ctx);
      case 'sprint':
        return executeSurvivalSprint(action, this.ctx);
      case 'dropItem':
        return executeSurvivalDropItem(action, this.ctx);

      // Stage 5: mining, building, crafting
      case 'equipItem':
        return executeSurvivalEquipItem(action, this.ctx);
      case 'equipArmor':
        return executeSurvivalEquipArmor(action, this.ctx);
      case 'collectDrops':
        return executeSurvivalCollectDrops(action, this.ctx);
      case 'craft':
        return executeSurvivalCraft(action, this.ctx);
      case 'openContainer':
        return executeSurvivalOpenContainer(action, this.ctx);
      case 'closeContainer':
        return executeCloseContainer(action, this.ctx);
      case 'storeItem':
        return executeSurvivalStoreItem(action, this.ctx);
      case 'retrieveItem':
        return executeSurvivalRetrieveItem(action, this.ctx);
      case 'eatFood':
        return executeSurvivalEatFood(action, this.ctx);
      case 'sleepInBed':
        return executeSurvivalSleepInBed(action, this.ctx);
      case 'scanNearby':
        return executeScanNearby(action, this.ctx);
      case 'deepScan':
        return executeDeepScan(action, this.ctx);

      // Memory actions (shared across modes)
      case 'rememberLocation':
        return executeRememberLocation(action, this.ctx, this.memoryManager);
      case 'goToLocation':
        return executeGoToLocation(action, this.ctx, this.memoryManager, false);
      case 'addMemory':
        return executeAddMemory(action, this.memoryManager);
      case 'recallMemories':
        return executeRecallMemories(action, this.memoryManager);
      case 'saveSkill':
        return executeSaveSkill(action, this.memoryManager);
      case 'addPlayerNote':
        return executeAddPlayerNote(action, this.memoryManager);
      case 'think':
        if (!this.llmClient) return { success: false, message: 'Reasoning model not available', actionType: 'think' };
        return executeThink(action, this.ctx, this.memoryManager, this.llmClient);

      default:
        return { success: false, message: `Unknown action type: ${(action as any).type}`, actionType: 'unknown' };
    }
  }

  getStatus(): string {
    if (this.cheatsEnabled) {
      if (isFollowing()) return `Currently following ${getFollowTarget()}`;
    } else {
      if (isSurvivalFollowing()) return `Currently following ${getSurvivalFollowTarget()}`;
    }
    return 'Idle';
  }
}
