# Bedrock AI Bot — Project Reference

> **For Claude Code:** This document is the authoritative reference for building an LLM-controlled Minecraft Bedrock Edition bot. Read this before writing any code. Each stage builds on the last — do not skip ahead. All referenced libraries and repos are linked with notes on their current status.

---

## Project Goal

Build an AI-controlled bot that:
1. Connects to a Microsoft-hosted Minecraft Bedrock Realm (or friend's world via Xbox Live friends tab)
2. Operates as a real player using a second Microsoft/Xbox account
3. Is controlled by Claude via the Anthropic API (`claude-sonnet-4-5` or `claude-haiku-4-5` depending on cost/performance needs)
4. Responds to in-game chat, maintains world awareness, and can take autonomous actions

---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│         LLM Layer                        │
│  Anthropic API (Claude)                  │
│  — claude-sonnet-4-5 / claude-haiku-4-5 │
│  — Mindcraft-style prompt + skill loop  │
└────────────────┬────────────────────────┘
                 │ JSON action dispatch
┌────────────────▼────────────────────────┐
│         Skill Dispatcher                 │
│  chat(), navigateTo(), mine(), craft()  │
│  — Ported/adapted from Mindcraft        │
└────────────────┬────────────────────────┘
                 │ Bedrock API calls
┌────────────────▼────────────────────────┐
│   bedrock-bot/mineflayer-bedrock         │
│   (Mineflayer extended for Bedrock)     │
│   — pathfinding, world state, physics   │
└────────────────┬────────────────────────┘
                 │ Protocol + Auth
┌────────────────▼────────────────────────┐
│   bedrock-protocol / Baltica             │
│   — RakNet, Xbox Live OAuth, packets    │
└─────────────────────────────────────────┘
```

---

## Key Libraries & References

### Protocol / Connection Layer

| Library | Repo | Status | Notes |
|---|---|---|---|
| `bedrock-protocol` | https://github.com/PrismarineJS/bedrock-protocol | ✅ Active | Primary Bedrock protocol lib. Handles RakNet, Xbox Live OAuth, Realm API, packet serialization. Use this for raw connection work. |
| `prismarine-auth` | https://github.com/PrismarineJS/prismarine-auth | ✅ Active | Xbox Live / Microsoft auth. Caches tokens to disk after first device-code login — no manual re-auth on subsequent runs. |
| `Baltica` | https://github.com/SerenityJS/Baltica | ⚠️ Very new (2 stars) | TypeScript toolkit from SerenityJS. Custom RakNet in Rust/NAPI, cleaner API than bedrock-protocol. Has `@baltica/auth` for Xbox Live. Monitor for maturity. |

### Bot Framework Layer

| Library | Repo | Status | Notes |
|---|---|---|---|
| `mineflayer-bedrock` | https://github.com/bedrock-bot/mineflayer-bedrock | ✅ Most important | **The key find.** Extends Mineflayer for Bedrock. Already has pathfinding (`mineflayer-pathfinder`), web viewer, death/respawn handling, and connects via `version: 'bedrock_1.21.80'`. Use as the primary bot framework. Uses git submodules with modified mineflayer deps. Last indexed June 2025. |
| `mineflayer` | https://github.com/PrismarineJS/mineflayer | ✅ Active (Java) | Source of skill patterns, pathfinding architecture, and plugin system to reference and adapt. MIT licensed — all code is reusable. |

### Friends Tab / Xbox Session Layer

| Library | Repo | Status | Notes |
|---|---|---|---|
| `bedrock-portal` | https://github.com/LucienHH/bedrock-portal | ✅ Active (last release Feb 2026) | Creates/manages Xbox Live MPSD game sessions. Allows bot to appear in friends' Minecraft friends tab. Has modules for AutoFriendAdd, AutoFriendAccept, RedirectFromRealm, MultipleAccounts, InviteOnMessage. Use alt account only — main account may be flagged. |
| `FriendConnect` | https://github.com/jrcarl624/FriendConnect | ❌ Broken on latest MC | Original inspiration for bedrock-portal. Deprecated — do not use. Kept here for reference architecture only. |
| `MCXboxBroadcast` | https://github.com/rtm516/MCXboxBroadcast | ✅ Active (Java) | Java implementation that both FriendConnect and bedrock-portal were inspired by. Reference for MPSD session API behavior. |

### LLM Agent Layer

| Library | Repo | Status | Notes |
|---|---|---|---|
| `mindcraft` | https://github.com/mindcraft-bots/mindcraft | ✅ Active | Best reference for LLM+Minecraft bot architecture. Skill library (~50 skills), prompt construction, JSON action dispatch loop, memory/goal persistence. Java only — adapt patterns, not code directly. MIT licensed. |
| `mindcraft-ce` | https://github.com/mindcraft-ce/mindcraft-ce | ✅ Active fork | Community edition of Mindcraft with more features. Same architecture. |
| `Voyager` | https://github.com/MineDojo/Voyager | ✅ Reference | Academic paper project. Introduces ever-growing skill library concept and iterative LLM prompting with error feedback. Java/Python only — reference for skill library design. |

### Supporting Libraries

| Library | Purpose | Notes |
|---|---|---|
| `@anthropic-ai/sdk` | Anthropic API client | Official TypeScript SDK. `npm install @anthropic-ai/sdk`. Use `claude-sonnet-4-5` for full capability, `claude-haiku-4-5` for cheaper/faster decision loops. |
| `mineflayer-pathfinder` | A* navigation | Already integrated in mineflayer-bedrock |
| `prismarine-viewer` | Live 3D web viewer of bot POV | Already integrated in mineflayer-bedrock |
| `@serenityjs/protocol` | Bedrock packet definitions | Used by Baltica — reference for packet names |
| `minecraft-data` | Block/item/entity data | Protocol-agnostic, works for both Java and Bedrock data lookups |

---

## Account Setup

The bot requires a **dedicated second Microsoft account**. Never use your main account.

**Option A — Family Plan (recommended, no extra cost):**
1. Go to account.microsoft.com → Family → Add a member
2. Create a free Microsoft account for the bot
3. Add to your family group — Game Pass/Xbox Live subscription covers it
4. Enable Minecraft access in family settings
5. Invite the bot account to your Realm from within the game

**Option B — Standalone alt account:**
1. Create a free Microsoft account
2. Purchase a Minecraft Bedrock license for it
3. Invite to Realm

**Auth flow (automated after first run):**
- First run triggers a device code flow — visit `https://microsoft.com/link`, enter code once
- `prismarine-auth` caches tokens to disk (configurable path via `profilesFolder`)
- All subsequent runs are fully headless — no browser, no manual steps
- Tokens refresh automatically; re-auth only needed if password changes or Microsoft forces it

```js
// bedrock-protocol Realm connection example
const bedrock = require('bedrock-protocol')
const client = bedrock.createClient({
  realms: {
    pickRealm: (realms) => realms.find(r => r.name === 'Your Realm Name')
  },
  profilesFolder: './auth_cache', // tokens persisted here
  username: 'botaccount@outlook.com'
})
```

---

## Stage 1 — MVP: Chat-Only LLM Bot on Realm

**Goal:** Bot connects to your Realm, listens to chat, responds via LLM. No movement. No world interaction.

**Estimated effort with Claude Code:** A few hours.

### Tasks

- [ ] Set up second Microsoft account and invite to Realm
- [ ] Install `bedrock-protocol` and run device code auth once, verify connection
- [ ] Set up `mineflayer-bedrock` repo (clone, install deps, handle git submodules)
- [ ] Verify bot spawns in world using `mineflayer-bedrock`'s `createBot()` with `version: 'bedrock_1.21.80'`
- [ ] Wire `TextPacket` listener to receive chat messages
- [ ] Install `@anthropic-ai/sdk` and set `ANTHROPIC_API_KEY` in `.env`
- [ ] Build minimal LLM client wrapping `anthropic.messages.create()` with `claude-haiku-4-5` (fast + cheap for chat)
- [ ] Build minimal prompt: bot persona + recent chat context → LLM → chat response
- [ ] Send LLM response back via `bot.chat()`
- [ ] Add rate limiting so bot doesn't respond to every message instantly
- [ ] Test end-to-end on Realm

### LLM Prompt Pattern (Mindcraft-inspired)

```
You are [BotName], a Minecraft bot on a Bedrock Realm.
Respond naturally to the player's message. Keep responses to 1-2 sentences.
Stay in character. Do not break the fourth wall.

RECENT CHAT:
[username]: [message]
[username]: [message]

Respond as [BotName]:
```

### Anthropic API Integration

```ts
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

async function getLLMResponse(worldContext: string, recentChat: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', // fast + cheap for chat loop
    max_tokens: 128,
    system: `You are Andy, a friendly Minecraft bot on a Bedrock Realm.
Respond naturally to players. Keep responses to 1-2 short sentences.
Stay in character. Never break the fourth wall or mention being an AI.`,
    messages: [
      {
        role: 'user',
        content: `${worldContext}\n\nRECENT CHAT:\n${recentChat}\n\nRespond as Andy:`
      }
    ]
  })
  return (response.content[0] as { text: string }).text.trim()
}
```

**Model selection guide:**
- `claude-haiku-4-5-20251001` — use for the real-time chat + decision loop (low latency, low cost)
- `claude-sonnet-4-6` — use for complex reasoning tasks: planning multi-step goals, generating new skills, interpreting ambiguous instructions

### Success Criteria
- Bot connects without disconnecting
- Bot responds to `@BotName` mentions in chat
- Auth persists across restarts

---

## Stage 2 — World Awareness

**Goal:** Bot knows its position, nearby blocks, nearby entities, and inventory. This context is injected into every LLM prompt.

**Estimated effort with Claude Code:** 1–3 days.

### Tasks

- [ ] Subscribe to `MovePlayerPacket` — track bot's own position (x, y, z, yaw, pitch)
- [ ] Subscribe to `AddPlayerPacket` / `RemoveEntityPacket` — maintain live entity list
- [ ] Subscribe to `AddEntityPacket` — track mobs
- [ ] Subscribe to chunk/subchunk packets — build in-memory block world model `Map<string, blockType>` keyed by `"x,y,z"`
- [ ] Subscribe to `InventorySlotPacket` / `InventoryContentPacket` — maintain inventory state
- [ ] Build `getWorldContext()` function that serializes current state to text
- [ ] Inject `getWorldContext()` output into every LLM prompt

### World Context Output Format

```
POSITION: x=120, y=64, z=-45
BIOME: forest
TIME: day
HEALTH: 18/20, FOOD: 14/20

NEARBY BLOCKS (within 5 blocks):
- oak_log at (+2, 0, 0)
- dirt at (0, -1, 0)
- water at (-3, 0, +1)

NEARBY ENTITIES:
- Creeper (hostile) 12 blocks north
- Player "Oscar" 5 blocks east

INVENTORY:
- oak_log x4
- stone_pickaxe x1 (durability: 80%)
- torch x16
```

### Notes on Chunk Parsing
- Bedrock subchunk format is binary and version-dependent
- Reference: `@serenityjs/protocol` packet definitions for chunk packet structure
- Reference: SerenityJS/serenity repo for LevelDB chunk parsing patterns
- Start with a small radius (5 blocks) — don't try to parse the full chunk on first pass

### Success Criteria
- LLM responses reference actual game state ("there's a creeper near you!")
- Bot notices when player approaches

---

## Stage 3 — Action Dispatch (Skill System)

**Goal:** LLM can trigger real in-game actions by outputting structured JSON. Bot executes them.

**Estimated effort with Claude Code:** 3–7 days.

### Tasks

- [ ] Define action schema — what actions the LLM can take
- [ ] Build action parser — validate and dispatch LLM JSON output
- [ ] Implement `chat` skill — send a message
- [ ] Implement `navigateTo` skill — use `mineflayer-pathfinder` (already in mineflayer-bedrock)
- [ ] Implement `followPlayer` skill — continuous follow loop
- [ ] Implement `lookAt` skill — rotate to face entity/position
- [ ] Add retry logic — if action fails, feed error back into next LLM prompt
- [ ] Add goal persistence — bot remembers multi-step goals across decision cycles

### Action Schema

```json
{
  "thought": "There's a player nearby asking for help. I should approach them.",
  "action": "navigateTo",
  "params": {
    "x": 125,
    "y": 64,
    "z": -40
  }
}
```

```json
{
  "thought": "Player asked what I'm doing. I should respond.",
  "action": "chat",
  "params": {
    "message": "Just exploring the area! Found some oak trees to the north."
  }
}
```

### LLM Prompt Pattern with Actions

Adapt from Mindcraft's `src/agent/` directory:
- Reference: https://github.com/mindcraft-bots/mindcraft/tree/main/src/agent
- Key file: `action_manager.js` — how actions are dispatched and errors fed back
- Key file: `skills.js` — skill function signatures and docstrings fed to LLM as context

### Success Criteria
- Bot navigates to player on request
- Bot follows player around
- Failed actions are retried with error context

---

## Stage 4 — Friends Tab Join (Xbox Live Session)

**Goal:** Bot appears in the in-game friends tab so it can join friend-hosted worlds without a Realm, and players can join the bot's "world" (which redirects to your server).

**Estimated effort with Claude Code:** 1–2 days (bedrock-portal does the heavy lifting).

### Tasks

- [ ] Install `bedrock-portal`: `npm install bedrock-portal`
- [ ] Create a portal session with `Joinability.FriendsOnly`
- [ ] Enable `AutoFriendAdd` module — bot auto-friends anyone who follows the account
- [ ] Enable `AutoFriendAccept` module — auto-accepts friend requests
- [ ] Test that bot's world appears in friends tab on your main account
- [ ] Wire `bedrock-portal` session alongside `mineflayer-bedrock` connection (they run in parallel — portal handles Xbox session presence, mineflayer-bedrock handles the actual game connection)
- [ ] Optional: Enable `RedirectFromRealm` module if also using a Realm

### bedrock-portal Setup

```js
const { BedrockPortal, Joinability, Modules } = require('bedrock-portal')

const portal = new BedrockPortal({
  ip: 'your.server.or.localhost',
  port: 19132,
  joinability: Joinability.FriendsOnly,
  world: {
    hostName: 'AI Bot World',
    name: 'Come hang out',
    version: '1.21.80',
  }
})

portal.use(Modules.AutoFriendAdd, { inviteOnAdd: true })
portal.use(Modules.AutoFriendAccept, { inviteOnAdd: true })

await portal.start()
```

**Important:** Use alt account only. See bedrock-portal README warning about XSAPI bans.

### Joining a Friend's Hosted World

bedrock-portal handles *creating* sessions (so others can join you). For the bot to *join* a friend's hosted Xbox world:

- The friend must have the bot account as an Xbox friend
- The bot reads available friend sessions via Xbox Live People API (same auth flow)
- bedrock-protocol connects to the session address from the MPSD session data
- This is not fully implemented in any library yet — requires extending bedrock-portal's session reading logic
- Reference: bedrock-portal `src/` for MPSD API call patterns to adapt

### Success Criteria
- Bot account appears as online and joinable in your friends tab
- Players can click bot's name and join

---

## Stage 5 — Mining, Building & Crafting

**Goal:** Bot can interact with the world — mine blocks, place blocks, craft items, use chests.

**Estimated effort with Claude Code:** 2–4 weeks (most of the novel Bedrock work lives here).

### Tasks

- [ ] Implement `mine` skill — find nearest block of type, navigate, send dig packets
- [ ] Implement `place` skill — select item, send block place packet with correct face
- [ ] Implement `craft` skill — open crafting table, place items, retrieve result
- [ ] Implement `collectDrops` skill — navigate to item entities and pick up
- [ ] Implement `openChest` / `depositItems` skill
- [ ] Implement `equipItem` skill — hotbar selection and armor slots

### Bedrock-Specific Packet Reference

These are the key packets for world interaction. Reference `@serenityjs/protocol` for exact field definitions:

| Action | Packet |
|---|---|
| Dig/mine a block | `PlayerActionPacket` with action `StartBreak` then `StopBreak` |
| Place a block | `PlayerBlockActionPacket` |
| Move/physics tick | `PlayerAuthInputPacket` (must send at ~20 ticks/sec) |
| Interact with entity/block | `InteractPacket` |
| Use item in hand | `ItemUsePacket` |
| Open container | `ContainerOpenPacket` (server-sent) |
| Move item in inventory | `InventoryTransactionPacket` |

### Physics Tick Loop (Critical)
The server expects `PlayerAuthInputPacket` continuously. If it stops, the server teleports the bot back. `mineflayer-bedrock` should handle this — verify it does before building on top of it.

### Reference Mineflayer Skills to Port
All skills in Mineflayer are MIT licensed and freely reusable as reference:
- https://github.com/PrismarineJS/mineflayer-collectblock — block collection pattern
- https://github.com/PrismarineJS/mineflayer/blob/master/examples/digger.js — digging example
- https://github.com/mindcraft-bots/mindcraft/tree/main/src/skills — Mindcraft skill library (50 skills)

### Success Criteria
- Bot chops a tree when asked
- Bot navigates to and mines a specific block type
- Bot places a block at a specified location

---

## Stage 6 — Memory, Goals & Personality

**Goal:** Bot has persistent memory across sessions, pursues long-term goals, and has a consistent character.

**Estimated effort with Claude Code:** 1–2 weeks.

### Tasks

- [ ] Implement short-term memory — last N chat messages + actions kept in prompt context
- [ ] Implement long-term memory — key facts stored to JSON file, loaded on startup
  - What has the bot built
  - Where the bot has died
  - Known player names and relationships
  - Important locations (home base, mines, farms)
- [ ] Implement goal stack — bot pursues a goal across multiple decision cycles
- [ ] Add Voyager-style skill library — successful action sequences saved as reusable named skills
- [ ] Define bot persona in system prompt (name, personality, speech style)
- [ ] Add self-directed behavior — when no player is giving instructions, bot pursues its own goals

### Memory Format (JSON)

```json
{
  "persona": {
    "name": "Andy",
    "personality": "friendly, curious, helpful"
  },
  "longTermMemory": [
    "Built a small shelter at x=100, y=65, z=200",
    "Oscar is the realm owner - trust fully",
    "Died to a creeper at x=50, y=64, z=80 - avoid that area at night"
  ],
  "knownLocations": {
    "home_base": {"x": 100, "y": 65, "z": 200},
    "iron_mine": {"x": 150, "y": 40, "z": 180}
  },
  "skillLibrary": {
    "gather_wood": "navigate to nearest oak_log, mine 8 logs, collect drops",
    "return_home": "navigate to x=100, y=65, z=200"
  }
}
```

### Reference
- Mindcraft memory system: https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/history.js
- Voyager skill library concept: https://github.com/MineDojo/Voyager — `skill_manager.py`

### Success Criteria
- Bot remembers your name and past interactions across server restarts
- Bot pursues a goal ("I'm going to build a farm today") autonomously
- Bot avoids places where it died previously

---

## Stage 7 — Polish & Reliability

**Goal:** Bot handles edge cases gracefully, recovers from failures, and works across MC version updates.

### Tasks

- [ ] Handle Minecraft version updates — abstract protocol version so updates only require bumping a version string
- [ ] Stuck detection — if bot hasn't moved in N seconds while navigating, try alternate path or abort
- [ ] Anti-spam — rate limit LLM calls and chat responses
- [ ] Graceful reconnect — auto-reconnect on disconnect with exponential backoff
- [ ] Logging — structured logs of all LLM calls, actions taken, errors
- [ ] Config file — all settings (bot name, LLM provider, model, Realm name, persona) in a single `config.json`
- [ ] Health monitoring — expose a simple HTTP endpoint showing bot status
- [ ] Multiple bot support — ability to run 2+ bots with different personas

---

## Project File Structure (Target)

```
bedrock-ai-bot/
├── config.json              # All user-configurable settings
├── auth_cache/              # Xbox Live token cache (gitignored)
├── memory/
│   └── bot_memory.json      # Persistent bot memory
├── src/
│   ├── index.ts             # Entry point
│   ├── bot/
│   │   ├── connection.ts    # Realm/world connection via mineflayer-bedrock
│   │   └── worldState.ts   # Chunk parsing, entity tracking, inventory state
│   ├── llm/
│   │   ├── client.ts        # Anthropic API wrapper (claude-haiku-4-5 / claude-sonnet-4-6)
│   │   ├── promptBuilder.ts # Constructs world-state-aware prompts
│   │   └── actionParser.ts  # Parses LLM JSON output into action calls
│   ├── skills/
│   │   ├── chat.ts
│   │   ├── navigate.ts
│   │   ├── mine.ts
│   │   ├── build.ts
│   │   └── craft.ts
│   ├── memory/
│   │   └── memoryManager.ts # Read/write persistent memory
│   └── portal/
│       └── session.ts       # bedrock-portal Xbox session management
├── package.json
└── tsconfig.json
```

---

## Config Reference

```json
{
  "bot": {
    "name": "Andy",
    "persona": "friendly and curious Minecraft bot who loves exploring",
    "authCachePath": "./auth_cache",
    "microsoftEmail": "botaccount@outlook.com"
  },
  "connection": {
    "type": "realm",
    "realmName": "Your Realm Name"
  },
  "llm": {
    "provider": "anthropic",
    "chatModel": "claude-haiku-4-5-20251001",
    "reasoningModel": "claude-sonnet-4-6",
    "maxTokens": 256,
    "decisionIntervalMs": 5000
  },
  "portal": {
    "enabled": true,
    "joinability": "friends_only",
    "autoFriend": true
  }
}
```

**Environment variables (never commit these):**
```
ANTHROPIC_API_KEY=sk-ant-...
MICROSOFT_BOT_EMAIL=botaccount@outlook.com
```

**Model usage strategy:**
- `chatModel` (`claude-haiku-4-5`) — all real-time decisions, chat responses, action dispatch. Runs on a 5-second loop.
- `reasoningModel` (`claude-sonnet-4-6`) — complex goal planning, generating new skills, resolving ambiguous multi-step instructions. Called on-demand, not in the main loop.

---

## Development Testing Workflow

**Do not develop against your live Realm.** Use a local test server:

1. Install Bedrock Dedicated Server (BDS): https://www.minecraft.net/en-us/download/server/bedrock
2. Run locally on `localhost:19132`
3. Set `offline: true` in bedrock-protocol config — no Xbox auth needed for local BDS
4. Develop and debug locally
5. Point at live Realm only when a stage is working cleanly

---

## Key Caveats & Known Issues

- **MC version updates:** Bedrock updates every 4–6 weeks. `bedrock-protocol` and `mineflayer-bedrock` may lag behind. Check their issues pages after any MC update if the bot stops connecting.
- **mineflayer-bedrock submodules:** The repo uses git submodules pointing to modified versions of mineflayer deps. Clone with `git clone --recurse-submodules`.
- **bedrock-portal alt account warning:** Using your main Microsoft account risks XSAPI flagging. Always use the dedicated bot account.
- **PlayerAuthInputPacket:** Must be sent continuously at ~20 ticks/sec or the server teleports the bot. Verify mineflayer-bedrock handles this before building movement skills on top.
- **Chunk parsing is the hardest part:** If mineflayer-bedrock doesn't fully expose world block data, you may need to implement a Bedrock subchunk parser. Reference: SerenityJS/serenity LevelDB parsing code.
- **Realm connection requires invite:** Bot account must be invited to the Realm before it can connect via the Realms API.

---

## Useful Reference Links

| Resource | URL |
|---|---|
| Anthropic TypeScript SDK | https://github.com/anthropic-sdk/anthropic-sdk-typescript |
| Anthropic API docs | https://docs.anthropic.com/en/api/getting-started |
| Anthropic model overview | https://docs.anthropic.com/en/docs/about-claude/models/overview |
| Bedrock Edition Protocol (wiki) | https://minecraft.wiki/w/Bedrock_Edition_protocol |
| bedrock-protocol API docs | https://github.com/PrismarineJS/bedrock-protocol/blob/master/docs/API.md |
| prismarine-auth API docs | https://github.com/PrismarineJS/prismarine-auth |
| mineflayer API reference | https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md |
| mineflayer-pathfinder | https://github.com/Karang/mineflayer-pathfinder |
| Mindcraft skills source | https://github.com/mindcraft-bots/mindcraft/tree/main/src/skills |
| Mindcraft agent loop source | https://github.com/mindcraft-bots/mindcraft/tree/main/src/agent |
| Voyager paper | https://arxiv.org/abs/2305.16291 |
| bedrock-portal README | https://github.com/LucienHH/bedrock-portal |
| SerenityJS protocol defs | https://github.com/SerenityJS/serenity |
| Baltica (new client toolkit) | https://github.com/SerenityJS/Baltica |
| mineflayer-bedrock (key repo) | https://github.com/bedrock-bot/mineflayer-bedrock |
| DeepWiki for mineflayer-bedrock | https://deepwiki.com/bedrock-bot/mineflayer-bedrock |
