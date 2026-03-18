// Quick test: connect a fake player and send chat messages to test the bot
const bedrock = require('bedrock-protocol');

const client = bedrock.createClient({
  host: '127.0.0.1',
  port: 19132,
  username: 'TestPlayer',
  offline: true,
  skipPing: true,
  version: '1.26.0',
  raknetBackend: 'jsp-raknet',
});

client.on('join', () => {
  console.log('[Test] Joined server');
});

client.on('spawn', () => {
  console.log('[Test] Spawned! Sending chat in 3s...');

  const message = process.argv[2] || 'hello ClaudeCraft!';

  setTimeout(() => {
    console.log(`[Test] Sending: "${message}"`);
    client.queue('text', {
      needs_translation: false,
      category: 'authored',
      type: 'chat',
      source_name: 'TestPlayer',
      message: message,
      xuid: '',
      platform_chat_id: '',
      has_filtered_message: false,
    });
  }, 3000);

  // Listen for responses
  client.on('text', (packet) => {
    if (packet.source_name && packet.source_name !== 'TestPlayer') {
      console.log(`[Test] Got response: <${packet.source_name}> ${packet.message}`);
    }
  });

  // Disconnect after 15s
  setTimeout(() => {
    console.log('[Test] Done, disconnecting.');
    client.close();
    process.exit(0);
  }, 15000);
});

client.on('error', (err) => {
  console.error('[Test] Error:', err.message);
});

client.on('kick', (reason) => {
  console.log('[Test] Kicked:', reason);
});
