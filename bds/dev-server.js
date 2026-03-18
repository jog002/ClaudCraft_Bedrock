// Lightweight Bedrock server using bedrock-protocol for local dev/testing.
// Supports both the bot (offline) and iPhone (online) connections.
// Usage: node bds/dev-server.js

const bedrock = require('bedrock-protocol');

const PORT = parseInt(process.env.BDS_PORT || '19132');

const server = bedrock.createServer({
  host: '0.0.0.0',
  port: PORT,
  motd: {
    motd: 'ClaudCraft Dev',
    levelName: 'devworld',
  },
  version: '1.26.0',
  offline: true, // No Xbox Live auth required
  raknetBackend: 'jsp-raknet',
  maxPlayers: 5,
});

// Override the advertised version to match the phone's client version.
// Protocol 924 is shared between 1.26.0 and 1.26.3, so they're compatible.
server.advertisement.version = '1.26.3';
server.advertisement.protocol = 924;

console.log(`[BDS] ClaudCraft Dev Server listening on 0.0.0.0:${PORT}`);
console.log(`[BDS] Protocol: 924 (advertised as 1.26.3, internal 1.26.0)`);
console.log(`[BDS] Mode: offline (no Xbox auth required)`);
console.log(`[BDS] Bot connects to: 127.0.0.1:${PORT}`);

// Get local IP for phone connections
const os = require('os');
const interfaces = os.networkInterfaces();
for (const [name, addrs] of Object.entries(interfaces)) {
  for (const addr of addrs) {
    if (addr.family === 'IPv4' && !addr.internal) {
      console.log(`[BDS] Phone connects to: ${addr.address}:${PORT} (${name})`);
    }
  }
}

console.log('');

const players = new Map(); // keyed by unique ID
let nextEntityId = 1n;
let nextRuntimeId = 1n;
let nextPlayerId = 1;

server.on('connect', (client) => {
  const playerId = nextPlayerId++;
  let username = client.username || 'Unknown';
  console.log(`[BDS] Player connecting: ${username}`);

  const entityId = nextEntityId++;
  const runtimeId = nextRuntimeId++;

  client.on('join', () => {
    // Resolve username from login profile if available
    if (client.profile?.name) username = client.profile.name;
    console.log(`[BDS] Player joined: ${username} (id=${playerId})`);
    players.set(playerId, { client, username });

    // Send start_game to initialize the client
    client.queue('start_game', {
      entity_id: entityId,
      runtime_entity_id: runtimeId,
      player_gamemode: 'creative',
      player_position: { x: 0, y: 65, z: 0 },
      rotation: { x: 0, z: 0 },
      seed: [0, 0],
      biome_type: 0,
      biome_name: 'minecraft:plains',
      dimension: 'overworld',
      generator: 1,
      world_gamemode: 'creative',
      hardcore: false,
      difficulty: 0,
      spawn_position: { x: 0, y: 65, z: 0 },
      achievements_disabled: true,
      editor_world_type: 'not_editor',
      created_in_editor: false,
      exported_from_editor: false,
      day_cycle_stop_time: 0,
      edu_offer: 0,
      edu_features_enabled: false,
      edu_product_uuid: '',
      rain_level: 0,
      lightning_level: 0,
      has_confirmed_platform_locked_content: false,
      is_multiplayer: true,
      broadcast_to_lan: true,
      xbox_live_broadcast_mode: 6,
      platform_broadcast_mode: 6,
      enable_commands: true,
      is_texturepacks_required: false,
      gamerules: [],
      experiments: [],
      experiments_previously_used: false,
      bonus_chest: false,
      map_enabled: false,
      permission_level: 4,
      server_chunk_tick_range: 4,
      has_locked_behavior_pack: false,
      has_locked_resource_pack: false,
      is_from_locked_world_template: false,
      msa_gamertags_only: false,
      is_from_world_template: false,
      is_world_template_option_locked: false,
      only_spawn_v1_villagers: false,
      persona_disabled: false,
      custom_skins_disabled: false,
      emote_chat_muted: false,
      game_version: '*',
      limited_world_width: 16,
      limited_world_length: 16,
      is_new_nether: false,
      edu_resource_uri: { button_name: '', link_uri: '' },
      experimental_gameplay_override: false,
      chat_restriction_level: 'none',
      disable_player_interactions: false,
      level_id: 'devworld',
      world_name: 'ClaudCraft Dev',
      premium_world_template_id: '00000000-0000-0000-0000-000000000000',
      is_trial: false,
      rewind_history_size: 0,
      server_authoritative_block_breaking: false,
      current_tick: [0, 0],
      enchantment_seed: 0,
      block_properties: [],
      multiplayer_correlation_id: '<dev>',
      server_authoritative_inventory: false,
      engine: '1.26.0',
      property_data: { type: 'compound', name: '', value: {} },
      block_pallette_checksum: [0, 0],
      world_template_id: '00000000-0000-0000-0000-000000000000',
      client_side_generation: false,
      block_network_ids_are_hashes: true,
      server_controlled_sound: false,
      has_server_join_info: false,
      server_join_info: { has_gathering_info: false },
      server_identifier: '',
      scenario_identifier: '',
      world_identifier: '',
      owner_identifier: '',
    });

    // Tell client it can spawn
    client.queue('play_status', { status: 'player_spawn' });

    // Broadcast join message to other players
    for (const [id, p] of players) {
      if (id !== playerId) {
        p.client.queue('text', {
          type: 'chat',
          needs_translation: false,
          source_name: '',
          xuid: '',
          platform_chat_id: '',
          filtered_message: '',
          message: `${username} joined the game`,
        });
      }
    }
  });

  client.on('spawn', () => {
    console.log(`[BDS] Player spawned: ${username}`);
  });

  // Handle command requests (cheats mode) — log and acknowledge
  client.on('command_request', (packet) => {
    console.log(`[BDS] /${packet.command} (from ${username})`);
    // Send a fake success response so the bot knows the command was received
    client.queue('text', {
      type: 'system',
      needs_translation: false,
      source_name: '',
      xuid: '',
      platform_chat_id: '',
      filtered_message: '',
      message: `[DevServer] Command executed: /${packet.command}`,
    });
  });

  // Handle movement packets — update position tracking
  client.on('move_player', (packet) => {
    // Just accept movement silently
  });

  // Handle player_action packets (jump, sneak, sprint, break, etc.)
  client.on('player_action', (packet) => {
    console.log(`[BDS] player_action: ${packet.action} (from ${username})`);
  });

  // Forward chat messages between players
  client.on('text', (packet) => {
    if (packet.type === 'chat' && packet.source_name) {
      console.log(`[BDS] <${packet.source_name}> ${packet.message}`);

      // Relay to all other connected players
      for (const [id, p] of players) {
        if (id !== playerId) {
          p.client.queue('text', {
            type: 'chat',
            needs_translation: false,
            source_name: packet.source_name,
            xuid: '',
            platform_chat_id: '',
            filtered_message: '',
            message: packet.message,
          });
        }
      }
    }
  });

  client.on('close', () => {
    console.log(`[BDS] Player disconnected: ${username}`);
    players.delete(playerId);
  });

  client.on('error', (err) => {
    console.log(`[BDS] Player error (${username}): ${err.message}`);
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[BDS] Shutting down...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[BDS] Shutting down...');
  server.close();
  process.exit(0);
});

console.log('[BDS] Server ready. Press Ctrl+C to stop.\n');
