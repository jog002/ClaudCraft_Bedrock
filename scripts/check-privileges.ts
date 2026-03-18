import { Authflow, Titles } from 'prismarine-auth';

const authflow = new Authflow(
  'roxyBdBest@gmail.com',
  './auth_cache',
  { flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo' },
);

async function xblRequest(url: string, contractVersion?: string): Promise<any> {
  const token: any = await authflow.getXboxToken('http://xboxlive.com');
  const headers: Record<string, string> = {
    'Authorization': `XBL3.0 x=${token.userHash};${token.XSTSToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Language': 'en-US',
  };
  if (contractVersion) headers['x-xbl-contract-version'] = contractVersion;

  const response = await fetch(url, { method: 'GET', headers });
  const text = await response.text();
  return { status: response.status, body: text.slice(0, 2000) };
}

async function main() {
  console.log('=== Xbox Account Privilege Diagnostic ===\n');

  await authflow.getXboxToken('http://xboxlive.com');
  console.log('Auth OK\n');

  const checks = [
    { name: 'Privacy settings', url: 'https://privacy.xboxlive.com/users/me/privacy/settings', cv: '2' },
    { name: 'Profile (AccountTier)', url: 'https://profile.xboxlive.com/users/me/profile/settings?settings=GameDisplayName,Gamertag,AccountTier,XboxOneRep', cv: '2' },
    { name: 'Presence (self)', url: 'https://userpresence.xboxlive.com/users/me', cv: '3' },
    { name: 'MPSD self sessions', url: 'https://sessiondirectory.xboxlive.com/serviceconfigs/4fc10100-5f7a-4470-899b-280835760c07/sessionTemplates/MinecraftLobby/sessions?xuid=2535415462330293', cv: '107' },
    { name: 'Handles query (friend)', url: 'https://sessiondirectory.xboxlive.com/handles?include=relatedInfo&q=xuid(2533274913826282)&type=activity', cv: '107' },
  ];

  for (const check of checks) {
    console.log(`--- ${check.name} ---`);
    try {
      const result = await xblRequest(check.url, check.cv);
      console.log(`Status: ${result.status}`);
      console.log(`Body: ${result.body}\n`);
    } catch (err: any) {
      console.log(`Error: ${err.message}\n`);
    }
  }
}

main().catch(console.error);
