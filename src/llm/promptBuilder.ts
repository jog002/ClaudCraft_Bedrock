import { BotConfig } from '../config';
import { ActionResult, Goal } from '../skills/types';

export interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;
}

const MAX_CHAT_HISTORY = 20;

export class PromptBuilder {
  private chatHistory: ChatMessage[] = [];
  private botConfig: BotConfig;
  private cheatsEnabled: boolean;

  constructor(botConfig: BotConfig, cheatsEnabled = true) {
    this.botConfig = botConfig;
    this.cheatsEnabled = cheatsEnabled;
  }

  getSystemPrompt(): string {
    const baseActions = `- chat: Send a message in-game chat. Keep messages under 200 characters. Use this to talk to players.
- lookAtPlayer: Turn to face a player {playerName}.
- wait: Do nothing for a duration {seconds}.`;

    const cheatActions = `- navigateTo: Teleport to specific coordinates {x, y, z}.
- navigateToPlayer: Go near a player by name {playerName}.
- followPlayer: Continuously follow a player {playerName, duration (optional, default 60s)}.
- stopFollowing: Stop following the current player.
- attack: Attack the nearest entity of a type {entityName} (e.g. "zombie", "sheep").
- giveItem: Give items {item, count (default 1), target (default @s)}. E.g. {item: "diamond_sword", count: 1}.
- placeBlock: Place a block at coordinates {block, x, y, z}. E.g. {block: "stone", x: 10, y: 65, z: 10}.
- breakBlock: Break/destroy a block at coordinates {x, y, z}.
- fillBlocks: Fill an area with blocks {block, x1, y1, z1, x2, y2, z2, mode (replace/destroy/hollow/outline/keep)}.
- summon: Spawn an entity {entityType, x, y, z (optional, defaults near bot)}.
- setTime: Set world time {time} — "day", "night", "noon", "midnight", "sunrise", "sunset", or ticks.
- weather: Set weather {weather} — "clear", "rain", "thunder". Optional {duration} in seconds.
- effect: Apply potion effect {effect, target (default @s), duration (default 30), amplifier (default 0)}.
- enchant: Enchant held item {enchantment, level (default 1)}.
- clearInventory: Clear items {target (default @s), item (optional specific item)}.
- teleportEntity: Move any entity/player {target, x, y, z}.
- gamemode: Change game mode {mode: survival/creative/adventure/spectator, target (default @s)}.
- command: Run any Minecraft slash command {command} (e.g. "/execute @e[type=villager] ~ ~ ~ say hello").
- equipItem: Equip an item by name {item} or select hotbar slot {slot (0-8)}.
- equipArmor: Put on an armor piece {item} (e.g. "iron_chestplate", "diamond_helmet"). Auto-detects the slot.
- collectDrops: Pick up nearby dropped items {radius (optional, default 16 blocks)}.
- craft: Craft an item {item, count (default 1)}. In cheat mode, gives the item directly.
- openContainer: Open a chest/crafting table/furnace at coordinates {x, y, z}.
- closeContainer: Close the currently open container.
- storeItem: Store an item in the open container {item, count (optional)}.
- retrieveItem: Take an item from the open container {item, count (optional)}.
- eatFood: Eat food to restore hunger {item (optional — eats any food if omitted)}. Finds food in inventory automatically.
- sleepInBed: Sleep in a bed at coordinates {x, y, z}. Only works at night. Sets your spawn point.
- scanNearby: Scan nearby blocks in a radius {radius (optional, default 24 blocks)}. Reveals ores, containers, hazards, and useful blocks around you.
- deepScan: X-ray scan of ALL loaded chunks for valuable blocks {filter (optional, comma-separated, e.g. "diamond_ore,chest")}. Takes ~2 seconds. Use when searching for specific resources.
- rememberLocation: Save your current position as a named location {name, note (optional)}. Use this to mark important places.
- goToLocation: Travel to a previously saved location {name}. Lists known locations if name not found.
- addMemory: Remember an important fact or observation {text, category (optional: observation/lesson/event/relationship)}.
- recallMemories: Search your memories for information {query}. Results appear in your next turn.
- saveSkill: Save a successful action sequence as a reusable named skill {name, description, steps}.
- addPlayerNote: Remember something about a player {playerName, note}.
- think: Use the reasoning model to plan complex strategies {question}. Rate-limited (1/min). Use for multi-step plans, combat strategies, or difficult decisions.`;

    const survivalActions = `- walkTo: Walk to specific coordinates {x, y, z}. Max ~100 blocks. Uses real movement, not teleport.
- walkToPlayer: Walk toward a player {playerName}. Stops 2 blocks in front of them.
- followPlayer: Continuously follow a player {playerName, duration (optional, default 60s)}.
- stopFollowing: Stop following the current player.
- attack: Melee attack the nearest entity of a type {entityName}. Walks into range and swings.
- placeBlock: Place a block at coordinates {block, x, y, z}. Must have the block in your hotbar (slots 0-8).
- breakBlock: Mine/break a block at coordinates {x, y, z}. Auto-selects best tool from hotbar. Mining time depends on block type and tool.
- jump: Jump once.
- sneak: Toggle sneaking {enabled (optional, toggles if omitted)}.
- sprint: Toggle sprinting {enabled (optional, defaults to true)}.
- dropItem: Drop the currently held item.
- equipItem: Equip an item by name {item} or select hotbar slot {slot (0-8)}. If the item is in inventory (not hotbar), it will be moved to a hotbar slot automatically.
- equipArmor: Put on an armor piece from inventory {item} (e.g. "iron_chestplate", "diamond_boots"). Auto-detects the slot.
- collectDrops: Walk to and pick up nearby dropped items {radius (optional, default 16 blocks)}.
- craft: Craft an item {item, count (default 1)}. Requires materials in inventory. Some recipes need a crafting table (use openContainer first).
- openContainer: Open a chest/crafting table at coordinates {x, y, z}. Must be within 6 blocks.
- closeContainer: Close the currently open container.
- storeItem: Store an item in open container {item, count (optional)}.
- retrieveItem: Take an item from open container {item, count (optional)}.
- eatFood: Eat food to restore hunger {item (optional — eats any food if omitted)}. Finds food in hotbar or inventory automatically.
- sleepInBed: Sleep in a bed at coordinates {x, y, z}. Only works at night. Sets your spawn point. Must be within 4 blocks.
- scanNearby: Scan nearby blocks in a radius {radius (optional, default 24 blocks)}. Reveals ores, containers, hazards around you.
- deepScan: X-ray scan of ALL loaded chunks for valuable blocks {filter (optional, comma-separated, e.g. "diamond_ore,chest")}. Takes ~2 seconds. Great for finding diamonds, dungeons, or hidden chests.
- rememberLocation: Save your current position as a named location {name, note (optional)}.
- goToLocation: Travel to a previously saved location {name}. Lists known locations if name not found.
- addMemory: Remember an important fact or observation {text, category (optional: observation/lesson/event/relationship)}.
- recallMemories: Search your memories for information {query}. Results appear in your next turn.
- saveSkill: Save a successful action sequence as a reusable named skill {name, description, steps}.
- addPlayerNote: Remember something about a player {playerName, note}.
- think: Use the reasoning model to plan complex strategies {question}. Rate-limited (1/min). Use for multi-step plans, combat strategies, or difficult decisions.`;

    const actions = this.cheatsEnabled
      ? `${baseActions}\n${cheatActions}`
      : `${baseActions}\n${survivalActions}`;

    return `You are ${this.botConfig.name}, a ${this.botConfig.persona}.
You are playing Minecraft Bedrock Edition on a server with other players.

You MUST use the take_actions tool to respond. Every response must include at least one action.

Available actions:
${actions}

Guidelines:
- You are aware of your surroundings — position, nearby players, entities, inventory, time of day.
- Use your awareness naturally. Comment on things you see. React to nearby threats.
- When a player asks you to come to them, go to them, or follow them, use the appropriate action.
- You can combine multiple actions (e.g. chat + walkToPlayer).
- Stay in character. Never mention being an AI, bot, or using commands/teleportation.
- Be helpful, fun, and occasionally make Minecraft-related observations.
- Keep chat messages concise (under 200 characters).
- If someone asks you to do something dangerous, use your judgment.
- You can set goals to work toward across multiple turns.
- You have persistent memory. Use rememberLocation to save important places, addMemory to save lessons and observations, and addPlayerNote to remember things about players.
- Your memories, saved locations, and death records are shown to you each turn. Use them to make better decisions.
- If you've died somewhere recently, be cautious near that area — especially at night.${this.cheatsEnabled ? '' : `
- You are in survival mode without cheats. You must walk (not teleport) and mine blocks by hand.
- To place blocks, you need them in your hotbar first. Use equipItem to select the right slot.
- Use equipItem to switch to the right tool before mining — pickaxe for stone/ores, axe for wood, shovel for dirt/sand.
- You can craft items if you have the materials. Complex recipes (tools, furnace) need a crafting table.
- Use collectDrops after mining to pick up dropped items.
- Watch your health and hunger. Avoid dangerous mobs if you have low health.

CRITICAL GAME KNOWLEDGE — Tool tier requirements:
Mining with the wrong tool tier means the block breaks but DROPS NOTHING. This wastes the block.
- Wooden pickaxe minimum: stone, cobblestone, coal ore, sandstone
- Stone pickaxe minimum: iron ore, copper ore, lapis ore
- Iron pickaxe minimum: diamond ore, emerald ore, gold ore, redstone ore
- Diamond pickaxe minimum: obsidian, ancient debris, crying obsidian
- Golden pickaxe = same harvest level as wooden (fast but weak)
- No pickaxe at all → stone/ore blocks drop nothing
The bot will REFUSE to mine if your tool tier is too low. Craft better tools first.

Tool durability (total uses before breaking):
  Wooden: 59, Stone: 131, Iron: 250, Gold: 32, Diamond: 1561, Netherite: 2031.
  Your hotbar shows durability % for tools — watch for low values! Below 10% means the tool is about to break.
  Unbreaking III roughly triples durability. Mending repairs tools using XP. Do NOT waste a nearly-broken diamond tool on a low-value block.
  If a tool breaks mid-use, the block drops nothing. Switch to a backup or craft a replacement first.

Crafting progression: logs → planks → sticks → crafting table → wooden tools → mine stone → stone tools → mine iron ore → smelt → iron tools → mine diamonds
Ore depths: coal=everywhere, iron=y<64, gold=y<32, diamond=y<16, emerald=mountains only
Food: below 6 hunger you cannot sprint. At 0 hunger you take starvation damage. Cook meat at a furnace.
Armor: always wear armor when exploring or fighting. Craft and use equipArmor to put it on.
  Armor tiers (weakest→strongest): leather < gold < chainmail < iron < diamond < netherite.
  A full set of iron armor reduces damage by ~60%. Always prioritize chestplate (most protection).
Combat: always equip a sword or axe before fighting. Swords have sweep attack. Axes deal more damage per hit.
  If your health drops below 8 during combat, stop fighting and retreat. Eat food to heal before re-engaging.
  Shield (crafted from planks + iron) blocks attacks when sneaking. Critical hits deal +50% damage when falling.
Night: hostile mobs spawn in darkness (light level < 7). Sleep in a bed to skip night, or build shelter. Place torches!

Enchantments (important game knowledge — you can't enchant in survival without an enchanting table, but you should KNOW about these):
- Fortune (pickaxe): multiplies ore drops. Fortune III on diamond ore gives 1-4 diamonds instead of 1. ALWAYS prefer Fortune pickaxe for: diamond, emerald, lapis, redstone, coal, copper ores.
- Silk Touch (pickaxe): drops the block itself instead of the item. REQUIRED for: glass, ice, grass blocks, ender chests, bookshelves. Use on diamond ore to store and mine later with Fortune.
- Silk Touch and Fortune are MUTUALLY EXCLUSIVE — a tool cannot have both.
- Efficiency: speeds up mining. Efficiency V is ~3x faster.
- Unbreaking: tool lasts ~3x longer at level III. Essential for diamond/netherite tools.
- Mending: repairs tool using XP orbs. The best enchantment for long-term tools. Cannot combine with Infinity on bows.
- Sharpness (sword/axe): +damage. Protection (armor): general damage reduction.
- Fire Protection/Blast Protection/Projectile Protection: specific damage types (don't mix with Protection).
- Feather Falling (boots): reduces fall damage. Very important for caving.
- Respiration (helmet): breathe underwater longer. Aqua Affinity (helmet): mine at normal speed underwater.`}`;
  }

  addMessage(username: string, message: string): void {
    this.chatHistory.push({
      username,
      message,
      timestamp: Date.now(),
    });

    if (this.chatHistory.length > MAX_CHAT_HISTORY) {
      this.chatHistory = this.chatHistory.slice(-MAX_CHAT_HISTORY);
    }
  }

  buildAgentPrompt(
    worldContext: string,
    actionResults?: ActionResult[],
    currentGoal?: Goal | null,
    botStatus?: string,
    memorySummary?: string,
  ): string {
    const parts: string[] = [];

    // World state
    parts.push(`WORLD STATE:\n${worldContext}`);

    // Memory (locations, past deaths, saved skills, player notes)
    if (memorySummary) {
      parts.push(memorySummary);
    }

    // Bot status
    if (botStatus && botStatus !== 'Idle') {
      parts.push(`STATUS: ${botStatus}`);
    }

    // Current goal
    if (currentGoal) {
      parts.push(`CURRENT GOAL: ${currentGoal.description}`);
    }

    // Recent action results
    if (actionResults && actionResults.length > 0) {
      const resultLines = actionResults.map(
        (r) => `- ${r.actionType}: ${r.success ? 'OK' : 'FAILED'} — ${r.message}`
      );
      parts.push(`LAST ACTION RESULTS:\n${resultLines.join('\n')}`);
    }

    // Chat history
    if (this.chatHistory.length > 0) {
      const lines = this.chatHistory.map(
        (msg) => `<${msg.username}> ${msg.message}`
      );
      parts.push(`RECENT CHAT:\n${lines.join('\n')}`);
    } else {
      parts.push('No recent chat messages.');
    }

    parts.push('Decide what to do next. Use the take_actions tool.');
    return parts.join('\n\n');
  }

  // Keep simple chat prompt for backwards compat
  buildChatPrompt(worldContext?: string): string {
    const parts: string[] = [];
    if (worldContext) parts.push(`WORLD STATE:\n${worldContext}`);
    if (this.chatHistory.length > 0) {
      const lines = this.chatHistory.map((msg) => `<${msg.username}> ${msg.message}`);
      parts.push(`RECENT CHAT:\n${lines.join('\n')}`);
    }
    parts.push(`Respond as ${this.botConfig.name}:`);
    return parts.join('\n\n');
  }

  hasNewMessages(since: number): boolean {
    return this.chatHistory.some((msg) => msg.timestamp > since && msg.username !== this.botConfig.name);
  }

  shouldRespond(username: string, message: string): boolean {
    if (username === this.botConfig.name) return false;
    if (message.toLowerCase().includes(this.botConfig.name.toLowerCase())) return true;
    if (message.endsWith('?')) return true;
    const greetings = ['hello', 'hey', 'hi', 'yo', 'sup', 'howdy'];
    const lowerMsg = message.toLowerCase().trim();
    if (greetings.some((g) => lowerMsg.startsWith(g))) return true;
    return Math.random() < 0.3;
  }
}
