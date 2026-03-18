// Patches bedrock-protocol and jsp-raknet for local development.
// 1. Switches default RakNet backend from raknet-native to jsp-raknet (pure JS)
// 2. Fixes jsp-raknet RakNet protocol version (10 → 11) for BDS 1.21+
const fs = require('fs');
const path = require('path');

// Patch 1: bedrock-protocol default backend
const bpTarget = path.join(__dirname, '..', 'node_modules', 'bedrock-protocol', 'src', 'createClient.js');
if (fs.existsSync(bpTarget)) {
  let content = fs.readFileSync(bpTarget, 'utf-8');
  const before = "require('./rak')('raknet-native')";
  const after = "require('./rak')('jsp-raknet')";

  if (content.includes(before)) {
    content = content.replace(before, after);
    fs.writeFileSync(bpTarget, content);
    console.log('[patch] Patched bedrock-protocol to use jsp-raknet backend.');
  } else {
    console.log('[patch] bedrock-protocol backend already patched or changed.');
  }
} else {
  console.log('[patch] bedrock-protocol not found, skipping backend patch.');
}

// Patch 2: jsp-raknet RakNet protocol version
// jsp-raknet v2.2.0 uses RAKNET_PROTOCOL = 10, but BDS 1.21.80+ requires 11.
// Without this patch, connection handshake fails with IncompatibleProtocolVersion.
const jspTarget = path.join(__dirname, '..', 'node_modules', 'jsp-raknet', 'js', 'Client.js');
if (fs.existsSync(jspTarget)) {
  let content = fs.readFileSync(jspTarget, 'utf-8');
  const before = 'const RAKNET_PROTOCOL = 10;';
  const after = 'const RAKNET_PROTOCOL = 11;';

  if (content.includes(before)) {
    content = content.replace(before, after);
    fs.writeFileSync(jspTarget, content);
    console.log('[patch] Patched jsp-raknet protocol version 10 → 11.');
  } else if (content.includes(after)) {
    console.log('[patch] jsp-raknet protocol already at version 11.');
  } else {
    console.log('[patch] jsp-raknet protocol version not found, skipping.');
  }
} else {
  console.log('[patch] jsp-raknet not found, skipping protocol patch.');
}
