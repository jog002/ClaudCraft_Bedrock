/**
 * Comprehensive skill test — connects as a player and sends raw packets
 * to verify every action type serializes without crashing.
 * Run inside Docker: docker exec claudcraft-bot node /app/bds/test-all-skills.js
 */
const bedrock = require('bedrock-protocol');

const client = bedrock.createClient({
  host: 'claudcraft-bds',
  port: 19132,
  username: 'SkillTester',
  offline: true,
  skipPing: true,
  version: '1.26.0',
});

let entityId = null;
const entities = new Map();
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

client.on('join', () => {
  client.on('add_entity', (p) => {
    entities.set(p.runtime_id, { type: p.entity_type, pos: p.position, rid: p.runtime_id });
  });
});

client.on('spawn', async () => {
  entityId = client.entityId;
  const rid = Number(entityId);
  console.log(`\nConnected as SkillTester, entityId: ${entityId}\n`);

  // Wait for entities to load
  await sleep(3000);

  // ═══════════════════════════════════════════════
  console.log('=== MOVEMENT PACKETS ===');
  // ═══════════════════════════════════════════════

  test('move_player (walk step)', () => {
    client.queue('move_player', {
      runtime_id: rid,
      position: { x: 5, y: 65, z: 5 },
      pitch: 0, yaw: 90, head_yaw: 90,
      mode: 'normal',
      on_ground: true,
      ridden_runtime_id: 0,
      tick: 0,
    });
  });

  test('move_player (rotation only)', () => {
    client.queue('move_player', {
      runtime_id: rid,
      position: { x: 5, y: 65, z: 5 },
      pitch: -30, yaw: 180, head_yaw: 180,
      mode: 'normal',
      on_ground: true,
      ridden_runtime_id: 0,
      tick: 0,
    });
  });

  // ═══════════════════════════════════════════════
  console.log('\n=== PLAYER_ACTION PACKETS ===');
  // ═══════════════════════════════════════════════

  const actionTypes = [
    'start_break', 'abort_break', 'stop_break',
    'jump', 'start_sprint', 'stop_sprint',
    'start_sneak', 'stop_sneak',
    'crack_break', 'predict_break',
    'start_item_use_on', 'stop_item_use_on',
    'drop_item',
  ];

  for (const action of actionTypes) {
    test(`player_action: ${action}`, () => {
      client.queue('player_action', {
        runtime_entity_id: entityId,
        action: action,
        position: { x: 0, y: 64, z: 0 },
        result_position: { x: 0, y: 64, z: 0 },
        face: 1,
      });
    });
  }

  // ═══════════════════════════════════════════════
  console.log('\n=== ANIMATE PACKETS ===');
  // ═══════════════════════════════════════════════

  test('animate: swing_arm', () => {
    client.queue('animate', {
      action_id: 'swing_arm',
      runtime_entity_id: entityId,
      data: 0.0,
      has_swing_source: false,
    });
  });

  test('animate: critical_hit', () => {
    client.queue('animate', {
      action_id: 'critical_hit',
      runtime_entity_id: entityId,
      data: 0.0,
      has_swing_source: false,
    });
  });

  // ═══════════════════════════════════════════════
  console.log('\n=== INVENTORY_TRANSACTION PACKETS ===');
  // ═══════════════════════════════════════════════

  // Attack entity
  const firstEntity = entities.values().next().value;
  if (firstEntity) {
    test('inventory_transaction: attack entity', () => {
      client.queue('inventory_transaction', {
        transaction: {
          legacy: { legacy_request_id: 0, legacy_transactions: [] },
          transaction_type: 'item_use_on_entity',
          actions: [],
          transaction_data: {
            entity_runtime_id: firstEntity.rid,
            action_type: 'attack',
            hotbar_slot: 0,
            held_item: { network_id: 0 },
            player_pos: { x: 5, y: 65, z: 5 },
            click_pos: { x: 0, y: 0, z: 0 },
          },
        },
      });
    });

    test('inventory_transaction: interact entity', () => {
      client.queue('inventory_transaction', {
        transaction: {
          legacy: { legacy_request_id: 0, legacy_transactions: [] },
          transaction_type: 'item_use_on_entity',
          actions: [],
          transaction_data: {
            entity_runtime_id: firstEntity.rid,
            action_type: 'interact',
            hotbar_slot: 0,
            held_item: { network_id: 0 },
            player_pos: { x: 5, y: 65, z: 5 },
            click_pos: { x: 0, y: 0, z: 0 },
          },
        },
      });
    });
  } else {
    console.log('  ⚠ No entities found to test attack/interact');
  }

  // Place block (item_use click_block)
  test('inventory_transaction: click_block (place)', () => {
    client.queue('inventory_transaction', {
      transaction: {
        legacy: { legacy_request_id: 0, legacy_transactions: [] },
        transaction_type: 'item_use',
        actions: [],
        transaction_data: {
          action_type: 'click_block',
          trigger_type: 'player_input',
          block_position: { x: 10, y: 64, z: 10 },
          face: 1,
          hotbar_slot: 0,
          held_item: { network_id: 0 },
          player_pos: { x: 5, y: 65, z: 5 },
          click_pos: { x: 0.5, y: 1.0, z: 0.5 },
          block_runtime_id: 0,
          client_prediction: 'failure',
        },
      },
    });
  });

  // Break block (item_use break_block)
  test('inventory_transaction: break_block', () => {
    client.queue('inventory_transaction', {
      transaction: {
        legacy: { legacy_request_id: 0, legacy_transactions: [] },
        transaction_type: 'item_use',
        actions: [],
        transaction_data: {
          action_type: 'break_block',
          trigger_type: 'player_input',
          block_position: { x: 10, y: 64, z: 10 },
          face: 1,
          hotbar_slot: 0,
          held_item: { network_id: 0 },
          player_pos: { x: 5, y: 65, z: 5 },
          click_pos: { x: 0.5, y: 0.5, z: 0.5 },
          block_runtime_id: 0,
          client_prediction: 'failure',
        },
      },
    });
  });

  // ═══════════════════════════════════════════════
  console.log('\n=== COMMAND_REQUEST PACKETS ===');
  // ═══════════════════════════════════════════════

  const commands = [
    'tp @s 0 65 0',
    'give @s diamond 1',
    'setblock 20 64 20 stone',
    'setblock 20 64 20 air destroy',
    'fill 25 64 25 30 64 30 stone 0 replace',
    'summon cow 0 65 5',
    'time set day',
    'weather clear',
    'effect @s speed 10 0',
    'enchant @s sharpness 1',
    'clear @s',
    'gamemode creative @s',
    'gamemode survival @s',
    'kill @e[type=cow,r=5,c=1]',
  ];

  for (const cmd of commands) {
    test(`command: /${cmd.split(' ').slice(0, 2).join(' ')}`, () => {
      client.queue('command_request', {
        command: cmd,
        origin: {
          type: 'player',
          uuid: '00000000-0000-0000-0000-000000000000',
          request_id: `test-${Date.now()}`,
          player_entity_id: BigInt(0),
        },
        internal: false,
        version: '1',
      });
    });
  }

  // ═══════════════════════════════════════════════
  console.log('\n=== TEXT PACKETS ===');
  // ═══════════════════════════════════════════════

  test('text: chat message', () => {
    client.queue('text', {
      needs_translation: false,
      category: 'authored',
      type: 'chat',
      source_name: 'SkillTester',
      message: 'Test message from skill tester',
      xuid: '',
      platform_chat_id: '',
      has_filtered_message: false,
    });
  });

  // ═══════════════════════════════════════════════
  console.log('\n=== INTERACT PACKETS ===');
  // ═══════════════════════════════════════════════

  if (firstEntity) {
    const interactActions = ['leave_vehicle', 'mouse_over_entity', 'open_inventory'];
    for (const action of interactActions) {
      test(`interact: ${action}`, () => {
        client.queue('interact', {
          action_id: action,
          target_entity_id: firstEntity.rid,
          has_position: false,
        });
      });
    }
  }

  // Wait for packets to flush
  await sleep(2000);

  // Check if we're still connected (no bad_packet kicks)
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  // Wait a bit more to see if we get kicked
  await sleep(3000);
  console.log('Still connected after all tests — no bad_packet kicks!');

  client.close();
  process.exit(failed > 0 ? 1 : 0);
});

client.on('kick', (reason) => {
  console.error('\n✗ KICKED:', JSON.stringify(reason));
  process.exit(1);
});

client.on('error', (err) => {
  console.error('Connection error:', err.message);
});

// Timeout safety
setTimeout(() => {
  console.error('\nTimeout — did not complete in time');
  process.exit(1);
}, 30000);
