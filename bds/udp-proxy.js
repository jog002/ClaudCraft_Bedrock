/**
 * Simple UDP proxy that forwards between a local port and Docker BDS.
 * Solves the jsp-raknet <-> Docker Desktop UDP incompatibility.
 *
 * Usage: node bds/udp-proxy.js [local_port] [remote_host] [remote_port]
 * Default: 19135 -> 127.0.0.1:19132
 *
 * How it works:
 * - Listens on local_port for UDP packets from jsp-raknet
 * - Forwards them to Docker BDS on remote_port
 * - Forwards replies back to the original sender
 * - Uses raw dgram sockets (no RakNet parsing)
 */
const dgram = require('dgram');

const LOCAL_PORT = parseInt(process.argv[2] || '19135');
const REMOTE_HOST = process.argv[3] || '127.0.0.1';
const REMOTE_PORT = parseInt(process.argv[4] || '19132');

const server = dgram.createSocket('udp4');
const remote = dgram.createSocket('udp4');

// Track client address (the first sender becomes "the client")
let clientAddr = null;
let clientPort = null;
let packetCount = { toServer: 0, toClient: 0 };

server.on('message', (msg, rinfo) => {
  // Store client info (from jsp-raknet)
  clientAddr = rinfo.address;
  clientPort = rinfo.port;
  packetCount.toServer++;

  // Forward to Docker BDS
  remote.send(msg, REMOTE_PORT, REMOTE_HOST);

  if (packetCount.toServer <= 5) {
    console.log(`[→ BDS] id=0x${msg[0].toString(16)} len=${msg.length} from ${rinfo.address}:${rinfo.port}`);
  }
});

remote.on('message', (msg, rinfo) => {
  // Forward reply back to client
  if (clientAddr && clientPort) {
    server.send(msg, clientPort, clientAddr);
    packetCount.toClient++;

    if (packetCount.toClient <= 5) {
      console.log(`[← BDS] id=0x${msg[0].toString(16)} len=${msg.length}`);
    }
  }
});

server.bind(LOCAL_PORT, () => {
  console.log(`[UDP Proxy] Listening on 0.0.0.0:${LOCAL_PORT}`);
  console.log(`[UDP Proxy] Forwarding to ${REMOTE_HOST}:${REMOTE_PORT}`);
  console.log(`[UDP Proxy] Bot should connect to 127.0.0.1:${LOCAL_PORT}`);
  console.log('');
});

// Stats every 10s
setInterval(() => {
  if (packetCount.toServer > 0 || packetCount.toClient > 0) {
    console.log(`[UDP Proxy] Packets: ${packetCount.toServer} → BDS, ${packetCount.toClient} ← BDS`);
  }
}, 10000);

process.on('SIGINT', () => {
  console.log('\n[UDP Proxy] Shutting down...');
  server.close();
  remote.close();
  process.exit(0);
});
