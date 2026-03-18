// Diagnostic script to test Bedrock server connectivity
const bedrock = require('bedrock-protocol');

const HOST = process.argv[2] || '192.168.1.237';
const PORT = parseInt(process.argv[3] || '19132');

console.log(`=== Bedrock Connection Diagnostics ===`);
console.log(`Target: ${HOST}:${PORT}\n`);

// Test 1: RakNet ping (does the server respond?)
console.log('[Test 1] RakNet ping...');
bedrock.ping({ host: HOST, port: PORT })
  .then(ad => {
    console.log('[Test 1] SUCCESS! Server responded:');
    console.log(`  MOTD: ${ad.motd}`);
    console.log(`  Name: ${ad.name}`);
    console.log(`  Version: ${ad.version}`);
    console.log(`  Protocol: ${ad.protocol}`);
    console.log(`  Players: ${ad.playersOnline}/${ad.playersMax}`);
    console.log(`  Port v4: ${ad.portV4}`);
    console.log(`  Port v6: ${ad.portV6}`);
    console.log('');
    testConnect(ad.version);
  })
  .catch(err => {
    console.log(`[Test 1] FAILED: ${err.message}`);
    console.log('  The server is not responding to RakNet pings.');
    console.log('  Possible causes:');
    console.log('  - "Visible to LAN Players" is off');
    console.log('  - Wrong IP address or port');
    console.log('  - Phone firewall blocking UDP');
    console.log('  - Minecraft is paused/backgrounded on the phone');
    console.log('');
    console.log('[Test 2] Trying direct connect anyway (skipPing)...');
    testConnect(null);
  });

function testConnect(version) {
  console.log(`[Test 2] Attempting connection${version ? ` (version ${version})` : ''}...`);

  const opts = {
    host: HOST,
    port: PORT,
    username: 'DiagBot',
    offline: true,
    raknetBackend: 'jsp-raknet',
    skipPing: true,
    connectTimeout: 10000,
  };

  if (version) {
    // Only set version if ping gave us one
    const supported = ['1.21.93','1.21.90','1.21.80','1.21.70','1.21.60','1.21.50'];
    const v = version.split('.').slice(0, 3).join('.');
    if (supported.includes(v)) {
      opts.version = v;
    } else {
      console.log(`  Warning: Server version ${version} may not be supported by bedrock-protocol`);
    }
  }

  const client = bedrock.createClient(opts);

  const timeout = setTimeout(() => {
    console.log('[Test 2] TIMEOUT after 10s — no response from server');
    client.close();
    process.exit(1);
  }, 15000);

  client.on('join', () => {
    console.log('[Test 2] SUCCESS — joined server!');
    clearTimeout(timeout);
    client.close();
  });

  client.on('spawn', () => {
    console.log('[Test 2] SUCCESS — spawned into world!');
    clearTimeout(timeout);
    client.close();
    process.exit(0);
  });

  client.on('error', (err) => {
    console.log(`[Test 2] ERROR: ${err.message}`);
  });

  client.on('kick', (reason) => {
    console.log(`[Test 2] KICKED: ${JSON.stringify(reason)}`);
    clearTimeout(timeout);
    client.close();
    process.exit(1);
  });

  client.on('close', () => {
    console.log('[Test 2] Connection closed.');
    clearTimeout(timeout);
  });

  // Log all packets for debugging
  client.on('packet', (packet) => {
    if (packet.data?.name) {
      console.log(`  [packet] ${packet.data.name}`);
    }
  });
}
