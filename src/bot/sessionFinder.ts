import { Authflow, Titles } from 'prismarine-auth';
import { Config } from '../config';

// Xbox Live / MPSD constants (from bedrock-portal)
const MINECRAFT_SCID = '4fc10100-5f7a-4470-899b-280835760c07';
const MINECRAFT_TEMPLATE = 'MinecraftLobby';

interface XboxToken {
  userHash: string;
  XSTSToken: string;
}

interface SessionConnection {
  ConnectionType: number;
  HostIpAddress: string;
  HostPort: number;
  NetherNetId?: bigint;
  WebRTCNetworkId?: bigint;
}

interface SessionResponse {
  properties: {
    custom: {
      hostName: string;
      worldName: string;
      version: string;
      MemberCount: number;
      MaxMemberCount: number;
      SupportedConnections: SessionConnection[];
      [key: string]: any;
    };
  };
  members: Record<string, {
    gamertag: string;
    constants: { system: { xuid: string } };
  }>;
}

interface HandleResponse {
  sessionRef: {
    scid: string;
    templateName: string;
    name: string;
  };
  type: string;
}

interface HandleQueryResponse {
  results: HandleResponse[];
}

export interface FriendWorld {
  hostGamertag: string;
  hostXuid: string;
  worldName: string;
  hostName: string;
  version: string;
  memberCount: number;
  maxMemberCount: number;
  sessionName: string;
  ip: string;
  port: number;
  connectionType: number;
}

interface XboxFriend {
  xuid: string;
  gamertag: string;
  presenceState: string;
  presenceText: string;
}

export class SessionFinder {
  private authflow: Authflow;
  private hostAuthflow: Authflow | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    // Bot account — used for Minecraft game connection
    this.authflow = new Authflow(
      config.bot.microsoftEmail,
      config.bot.authCachePath,
      {
        flow: 'live',
        authTitle: Titles.MinecraftNintendoSwitch,
        deviceType: 'Nintendo',
      },
    );

    // Host/friend account — used for session discovery (can query own sessions)
    if (config.connection.friendMicrosoftEmail) {
      this.hostAuthflow = new Authflow(
        config.connection.friendMicrosoftEmail,
        config.bot.authCachePath + '/host',
        {
          flow: 'live',
          authTitle: Titles.MinecraftNintendoSwitch,
          deviceType: 'Nintendo',
        },
      );
    }
  }

  getAuthflow(): Authflow {
    return this.authflow;
  }

  private async xblRequestAs(authflow: Authflow, method: string, url: string, data?: any): Promise<any> {
    const token: XboxToken = await authflow.getXboxToken('http://xboxlive.com') as any;
    const headers: Record<string, string> = {
      'Authorization': `XBL3.0 x=${token.userHash};${token.XSTSToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Language': 'en-US',
      'x-xbl-contract-version': '107',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Xbox API ${method} ${url} failed (${response.status}): ${text}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }

  private async xblRequest(method: string, url: string, data?: any): Promise<any> {
    const token: XboxToken = await this.authflow.getXboxToken('http://xboxlive.com') as any;
    const headers: Record<string, string> = {
      'Authorization': `XBL3.0 x=${token.userHash};${token.XSTSToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Language': 'en-US',
      'x-xbl-contract-version': '107',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Xbox API ${method} ${url} failed (${response.status}): ${text}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }

  private async xblPeopleRequest(method: string, url: string, data?: any): Promise<any> {
    const token: XboxToken = await this.authflow.getXboxToken('http://xboxlive.com') as any;
    const headers: Record<string, string> = {
      'Authorization': `XBL3.0 x=${token.userHash};${token.XSTSToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Language': 'en-US',
      'x-xbl-contract-version': '5',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Xbox People API ${method} ${url} failed (${response.status}): ${text}`);
    }

    return response.json();
  }

  /**
   * Get all Xbox friends of the bot account
   */
  async getFriends(): Promise<XboxFriend[]> {
    console.log('[Session] Fetching Xbox friends list...');
    const response = await this.xblPeopleRequest(
      'GET',
      'https://peoplehub.xboxlive.com/users/me/people/social/decoration/detail,preferredColor,presenceDetail'
    );
    const people = response.people || [];

    // Log each friend with their presence info for debugging
    for (const f of people) {
      console.log(`[Session]   Friend: "${f.gamertag}" (XUID: ${f.xuid}) — ${f.presenceState} — ${f.presenceText || 'no presence text'}`);
    }

    return people;
  }

  /**
   * Query the MPSD session directory for a player's active Minecraft session.
   * Tries multiple API approaches since the Xbox API is picky about formats.
   */
  async getPlayerSession(xuid: string): Promise<{ session: SessionResponse; sessionName: string } | null> {
    // Diagnostic: Check if our account has the multiplayer privilege
    try {
      console.log(`[Session]   Diagnostic: Checking bot account privileges...`);
      const token: any = await this.authflow.getXboxToken('http://xboxlive.com');
      console.log(`[Session]   Bot userHash: ${token.userHash}, token length: ${token.XSTSToken?.length}`);

      // Try to query our OWN sessions to see if we have the privilege
      const selfSessions = await this.xblRequest('GET',
        `https://sessiondirectory.xboxlive.com/serviceconfigs/${MINECRAFT_SCID}/sessionTemplates/${MINECRAFT_TEMPLATE}/sessions`
      );
      console.log(`[Session]   Self session query OK: ${JSON.stringify(selfSessions).slice(0, 200)}`);
    } catch (err: any) {
      console.log(`[Session]   Diagnostic: ${err.message}`);
    }

    // Approach 0: Use host's own account to query their sessions (bypasses privilege requirement)
    if (this.hostAuthflow) {
      try {
        console.log(`[Session]   Approach 0: Using host account to query own sessions...`);

        // Get the host's XUID from their own token
        const hostToken: any = await this.hostAuthflow.getXboxToken('http://xboxlive.com');
        console.log(`[Session]   Host auth OK (hash: ${hostToken.userHash})`);

        // Query the host's own sessions (self-query works on Silver tier)
        const sessions = await this.xblRequestAs(this.hostAuthflow, 'GET',
          `https://sessiondirectory.xboxlive.com/serviceconfigs/${MINECRAFT_SCID}/sessionTemplates/${MINECRAFT_TEMPLATE}/sessions?xuid=${xuid}`
        );
        console.log(`[Session]   Host's own sessions: ${JSON.stringify(sessions).slice(0, 500)}`);

        if (sessions?.results?.length > 0) {
          for (const s of sessions.results) {
            const name = s.sessionRef?.name || s.name;
            console.log(`[Session]   Found host session: ${name}`);

            // Fetch the full session details using the host's auth
            const url = `https://sessiondirectory.xboxlive.com/serviceconfigs/${MINECRAFT_SCID}/sessionTemplates/${MINECRAFT_TEMPLATE}/sessions/${name}`;
            const raw = await this.xblRequestAs(this.hostAuthflow, 'GET', url);
            console.log(`[Session]   Session details: ${JSON.stringify(raw).slice(0, 2000)}`);

            if (raw?.properties?.custom) {
              const session = raw as SessionResponse;
              return { session, sessionName: name };
            }
          }
        }

        // Also try handles/query from host's account (can query own handles)
        try {
          console.log(`[Session]   Trying handles/query from host account...`);
          const handles = await this.xblRequestAs(this.hostAuthflow, 'POST',
            'https://sessiondirectory.xboxlive.com/handles/query',
            {
              type: 'activity',
              owners: {
                people: {
                  moniker: 'people',
                  monikerXuid: xuid,
                },
              },
            }
          );
          console.log(`[Session]   Host handles response: ${JSON.stringify(handles).slice(0, 500)}`);

          if (handles?.results?.length > 0) {
            const sessionRef = handles.results[0].sessionRef;
            console.log(`[Session]   Found session via host handle: ${sessionRef.name}`);

            const url = `https://sessiondirectory.xboxlive.com/serviceconfigs/${sessionRef.scid}/sessionTemplates/${sessionRef.templateName}/sessions/${sessionRef.name}`;
            const raw = await this.xblRequestAs(this.hostAuthflow, 'GET', url);
            if (raw?.properties?.custom) {
              return { session: raw as SessionResponse, sessionName: sessionRef.name };
            }
          }
        } catch (err: any) {
          console.log(`[Session]   Host handles/query failed: ${err.message}`);
        }
      } catch (err: any) {
        console.log(`[Session]   Approach 0 (host self-query) failed: ${err.message}`);
      }
    }

    // Approach 1: POST handles/query with correct people moniker format
    try {
      console.log(`[Session]   Approach 1: POST handles/query (people moniker)...`);

      const handles = await this.xblRequest('POST',
        'https://sessiondirectory.xboxlive.com/handles/query',
        {
          type: 'activity',
          owners: {
            people: {
              moniker: 'people',
              monikerXuid: xuid,
            },
          },
        }
      );

      console.log(`[Session]   Handles response: ${JSON.stringify(handles).slice(0, 500)}`);

      if (handles?.results?.length > 0) {
        const sessionRef = handles.results[0].sessionRef;
        console.log(`[Session]   Found session via handle: ${sessionRef.name}`);
        return await this.fetchSession(sessionRef.scid, sessionRef.templateName, sessionRef.name);
      }
    } catch (err: any) {
      console.log(`[Session]   Approach 1 failed: ${err.message}`);
    }

    // Approach 3: People API multiplayerSummary — extract session info from joinable activities
    try {
      console.log(`[Session]   Approach 3: People API multiplayerSummary...`);

      const response = await this.xblPeopleRequest('GET',
        `https://peoplehub.xboxlive.com/users/me/people/xuids(${xuid})/decoration/multiplayerSummary,presenceDetail`
      );

      const person = response?.people?.[0];
      if (person) {
        console.log(`[Session]   ${person.gamertag}: presenceState=${person.presenceState}, presenceText=${person.presenceText}`);
        console.log(`[Session]   multiplayerSummary: ${JSON.stringify(person.multiplayerSummary)}`);
        console.log(`[Session]   presenceDetails: ${JSON.stringify(person.presenceDetails)}`);

        const activities = person.multiplayerSummary?.joinableActivities;
        if (activities?.length > 0) {
          console.log(`[Session]   Found ${activities.length} joinable activity(s)!`);

          for (let i = 0; i < activities.length; i++) {
            const activity = activities[i];
            // Log ALL fields so we can see exactly what Xbox gives us
            console.log(`[Session]   Activity[${i}] FULL DUMP: ${JSON.stringify(activity, null, 2)}`);
            console.log(`[Session]   Activity[${i}] keys: ${Object.keys(activity).join(', ')}`);

            // Check for connectionString — may contain encoded connection info
            if (activity.connectionString) {
              console.log(`[Session]   Activity[${i}] connectionString: ${activity.connectionString}`);
            }

            // If the activity has a direct sessionRef, use it
            if (activity.sessionRef) {
              console.log(`[Session]   Activity[${i}] has sessionRef: ${JSON.stringify(activity.sessionRef)}`);
              return await this.fetchSession(activity.sessionRef.scid, activity.sessionRef.templateName, activity.sessionRef.name);
            }

            // Try to resolve via handleId if present
            if (activity.handleId) {
              console.log(`[Session]   Activity[${i}] has handleId: ${activity.handleId}`);
              try {
                const handleData = await this.xblRequest('GET',
                  `https://sessiondirectory.xboxlive.com/handles/${activity.handleId}?include=relatedInfo,customProperties`
                );
                console.log(`[Session]   Handle data: ${JSON.stringify(handleData).slice(0, 500)}`);
                if (handleData?.sessionRef) {
                  return await this.fetchSession(handleData.sessionRef.scid, handleData.sessionRef.templateName, handleData.sessionRef.name);
                }
              } catch (err: any) {
                console.log(`[Session]   handleId lookup failed: ${err.message}`);
              }
            }

            // If groupId is present, try to resolve it
            if (activity.groupId) {
              console.log(`[Session]   Activity[${i}] has groupId: ${activity.groupId}`);

              // Try 1: Resolve groupId as a handle ID via GET /handles/{id}
              try {
                console.log(`[Session]   Trying GET /handles/${activity.groupId.slice(0, 12)}...`);
                const handleData = await this.xblRequest('GET',
                  `https://sessiondirectory.xboxlive.com/handles/${activity.groupId}`
                );
                console.log(`[Session]   Handle resolved: ${JSON.stringify(handleData).slice(0, 500)}`);
                if (handleData?.sessionRef) {
                  return await this.fetchSession(handleData.sessionRef.scid, handleData.sessionRef.templateName, handleData.sessionRef.name);
                }
              } catch (err: any) {
                console.log(`[Session]   GET handle by groupId failed: ${err.message}`);
              }

              // Try 2: Use the titleId from the activity to find the right SCID
              // presenceDetails shows TitleId 1810924247 (iOS), activity shows 896928775 (Win10)
              // The actual session might be under a different SCID
              const titleId = activity.titleId?.toString();
              if (titleId) {
                console.log(`[Session]   Activity titleId: ${titleId}, trying to map to SCID...`);

                // Try fetching session by groupId as session name
                try {
                  const url = `https://sessiondirectory.xboxlive.com/serviceconfigs/${MINECRAFT_SCID}/sessionTemplates/${MINECRAFT_TEMPLATE}/sessions/${activity.groupId}`;
                  const raw = await this.xblRequest('GET', url);
                  const rawStr = raw ? JSON.stringify(raw) : 'undefined';
                  console.log(`[Session]   GET session response: ${rawStr.slice(0, 500)}`);

                  // Check if it has real data (not stale from our previous PUT)
                  if (raw?.properties?.custom?.SupportedConnections?.length > 0) {
                    console.log(`[Session]   Found SupportedConnections!`);
                    return { session: raw as SessionResponse, sessionName: activity.groupId };
                  }

                  // Check if the host is actually a member of this session
                  const members = raw?.members;
                  if (members) {
                    const memberXuids = Object.values(members).map((m: any) => m?.constants?.system?.xuid);
                    console.log(`[Session]   Session members XUIDs: ${memberXuids.join(', ')}`);
                    const hostInSession = memberXuids.includes(xuid);
                    console.log(`[Session]   Host (${xuid}) in session: ${hostInSession}`);
                  }
                } catch (err: any) {
                  console.log(`[Session]   GET session by groupId failed: ${err.message}`);
                }
              }

              // Try 3: Join the session with RTA connection info to see full details
              try {
                console.log(`[Session]   Trying to join session ${activity.groupId.slice(0, 12)}... with proper RTA connection...`);
                const result = await this.joinSessionWithRTA(activity.groupId, xuid);
                if (result) return result;
              } catch (err: any) {
                console.log(`[Session]   RTA join failed: ${err.message}`);
              }
            }
          }
        } else {
          console.log(`[Session]   No joinable activities found for ${person.gamertag}.`);
        }
      }
    } catch (err: any) {
      console.log(`[Session]   Approach 3 (multiplayerSummary) failed: ${err.message}`);
    }

    // Approach 4: Multiplayer Activity API (separate from MPSD)
    for (const titleId of ['896928775', '1810924247', '1828326430']) {
      try {
        console.log(`[Session]   Approach 4: Multiplayer Activity API (titleId ${titleId})...`);
        const activities = await this.xblRequest('GET',
          `https://multiplayeractivity.xboxlive.com/titles/${titleId}/users/${xuid}/activities`
        );
        console.log(`[Session]   Activity API response: ${JSON.stringify(activities).slice(0, 500)}`);
        if (activities?.sessionReference) {
          return await this.fetchSession(activities.sessionReference.scid, activities.sessionReference.templateName, activities.sessionReference.name);
        }
      } catch (err: any) {
        console.log(`[Session]   Approach 4 (titleId ${titleId}) failed: ${err.message}`);
      }
    }

    // Approach 5: Query visible sessions (without private flag)
    try {
      console.log(`[Session]   Approach 5: Query sessions for XUID (no private flag)...`);
      const sessions = await this.xblRequest('GET',
        `https://sessiondirectory.xboxlive.com/serviceconfigs/${MINECRAFT_SCID}/sessionTemplates/${MINECRAFT_TEMPLATE}/sessions?xuid=${xuid}`
      );
      console.log(`[Session]   Sessions response: ${JSON.stringify(sessions).slice(0, 500)}`);

      if (sessions?.results?.length > 0) {
        const s = sessions.results[0];
        const sessionRef = s.sessionRef || { scid: MINECRAFT_SCID, templateName: MINECRAFT_TEMPLATE, name: s.name };
        return await this.fetchSession(sessionRef.scid, sessionRef.templateName, sessionRef.name);
      }
    } catch (err: any) {
      console.log(`[Session]   Approach 5 (session query) failed: ${err.message}`);
    }

    // Approach 6: Query our OWN sessions (we have privilege for this) — check if we ended up in the friend's session
    try {
      console.log(`[Session]   Approach 6: Query bot's own sessions...`);
      const token: any = await this.authflow.getXboxToken('http://xboxlive.com');
      // Extract our XUID from the token hash (or from a previous session response)
      const botXuid = '2535415462330293'; // CanadaCrease XUID from previous responses
      const sessions = await this.xblRequest('GET',
        `https://sessiondirectory.xboxlive.com/serviceconfigs/${MINECRAFT_SCID}/sessionTemplates/${MINECRAFT_TEMPLATE}/sessions?xuid=${botXuid}`
      );
      console.log(`[Session]   Bot's sessions: ${JSON.stringify(sessions).slice(0, 500)}`);

      if (sessions?.results?.length > 0) {
        for (const s of sessions.results) {
          const name = s.sessionRef?.name || s.name;
          console.log(`[Session]   Found bot session: ${name}`);
          const result = await this.fetchSession(MINECRAFT_SCID, MINECRAFT_TEMPLATE, name);
          if (result && result.session.properties?.custom?.SupportedConnections?.length > 0) {
            return result;
          }
        }
      }
    } catch (err: any) {
      console.log(`[Session]   Approach 6 (own sessions) failed: ${err.message}`);
    }

    // Approach 7: RTA subscription for session discovery
    try {
      console.log(`[Session]   Approach 7: RTA subscription for session discovery...`);
      const result = await this.rtaSessionDiscovery(xuid);
      if (result) return result;
    } catch (err: any) {
      console.log(`[Session]   Approach 7 (RTA) failed: ${err.message}`);
    }

    console.log(`[Session]   All session discovery approaches exhausted for XUID ${xuid}.`);
    return null;
  }

  /**
   * Join a session using RTA connection — mirrors bedrock-portal's Host.connect() + addConnection()
   * This properly sets up the bot as a member with an RTA-backed connection.
   */
  private async joinSessionWithRTA(sessionName: string, hostXuid: string): Promise<{ session: SessionResponse; sessionName: string } | null> {
    let rta: any = null;
    try {
      const { XboxRTA } = await import('xbox-rta');
      const uuid = () => crypto.randomUUID();

      rta = new XboxRTA(this.authflow);
      await rta.connect();

      const subResponse = await rta.subscribe('https://sessiondirectory.xboxlive.com/connections/');
      const connectionId = subResponse?.data?.ConnectionId;
      const subscriptionId = uuid();

      console.log(`[Session]   RTA ConnectionId: ${connectionId}`);

      if (!connectionId) {
        await rta.destroy();
        return null;
      }

      // Get our own XUID
      const token: any = await this.authflow.getXboxToken('http://xboxlive.com');

      // Join the session with proper RTA connection info (like bedrock-portal's addConnection)
      const url = `https://sessiondirectory.xboxlive.com/serviceconfigs/${MINECRAFT_SCID}/sessionTemplates/${MINECRAFT_TEMPLATE}/sessions/${sessionName}`;
      const joinPayload = {
        members: {
          me: {
            constants: { system: { initialize: true } },
            properties: {
              system: {
                active: true,
                connection: connectionId,
                subscription: {
                  id: subscriptionId,
                  changeTypes: ['everything'],
                },
              },
            },
          },
        },
      };

      console.log(`[Session]   PUT session with RTA connection...`);
      const raw = await this.xblRequest('PUT', url, joinPayload);
      console.log(`[Session]   Session response: ${JSON.stringify(raw).slice(0, 2000)}`);

      await rta.destroy();

      if (!raw) return null;

      const session = raw as SessionResponse;
      const custom = session.properties?.custom;
      if (custom?.SupportedConnections?.length > 0) {
        console.log(`[Session]   SUCCESS: Found SupportedConnections via RTA join!`);
        return { session, sessionName };
      }

      // Even if no SupportedConnections, log what we got
      console.log(`[Session]   RTA join succeeded but no SupportedConnections in response.`);
      if (custom) {
        console.log(`[Session]   Custom props: ${JSON.stringify(custom).slice(0, 500)}`);
      }

      // Check members to see if host is in the session
      if (raw.members) {
        console.log(`[Session]   Members: ${JSON.stringify(raw.members).slice(0, 500)}`);
      }

      return null;
    } catch (err: any) {
      if (rta) {
        try { await rta.destroy(); } catch (_) {}
      }
      throw err;
    }
  }

  /**
   * Use Xbox RTA (Real-Time Activity) to subscribe to session directory connections,
   * get a ConnectionId, and try to join the friend's session.
   */
  private async rtaSessionDiscovery(friendXuid: string): Promise<{ session: SessionResponse; sessionName: string } | null> {
    let rta: any = null;
    try {
      // Dynamic import of xbox-rta (installed as dep of bedrock-portal)
      const { XboxRTA } = await import('xbox-rta');

      rta = new XboxRTA(this.authflow);
      await rta.connect();
      console.log(`[Session]   RTA connected.`);

      // Subscribe to session directory connections
      const subResponse = await rta.subscribe('https://sessiondirectory.xboxlive.com/connections/');
      const connectionId = subResponse?.data?.ConnectionId;
      console.log(`[Session]   RTA ConnectionId: ${connectionId}`);
      console.log(`[Session]   RTA subscription response: ${JSON.stringify(subResponse?.data).slice(0, 500)}`);

      if (!connectionId) {
        console.log(`[Session]   RTA did not return a ConnectionId.`);
        await rta.destroy();
        return null;
      }

      // Now try handles/query again — having an active RTA connection may grant access
      try {
        const handles = await this.xblRequest('POST',
          'https://sessiondirectory.xboxlive.com/handles/query',
          {
            type: 'activity',
            owners: {
              people: {
                moniker: 'people',
                monikerXuid: friendXuid,
              },
            },
          }
        );

        console.log(`[Session]   RTA+handles response: ${JSON.stringify(handles).slice(0, 500)}`);

        if (handles?.results?.length > 0) {
          const sessionRef = handles.results[0].sessionRef;
          console.log(`[Session]   Found session via RTA+handles: ${sessionRef.name}`);
          await rta.destroy();
          return await this.fetchSession(sessionRef.scid, sessionRef.templateName, sessionRef.name);
        }
      } catch (err: any) {
        console.log(`[Session]   RTA+handles query failed: ${err.message}`);
      }

      await rta.destroy();
      return null;
    } catch (err: any) {
      if (rta) {
        try { await rta.destroy(); } catch (_) {}
      }
      throw err;
    }
  }

  /**
   * Fetch and log a session by its full reference
   */
  private async fetchSession(scid: string, templateName: string, sessionName: string): Promise<{ session: SessionResponse; sessionName: string } | null> {
    const url = `https://sessiondirectory.xboxlive.com/serviceconfigs/${scid}/sessionTemplates/${templateName}/sessions/${sessionName}`;

    // First try GET to read the session
    console.log(`[Session]   Fetching session: ${scid}/${templateName}/${sessionName}`);
    let raw: any;

    try {
      raw = await this.xblRequest('GET', url);
    } catch (err: any) {
      console.log(`[Session]   GET failed: ${err.message}`);
    }

    // If GET returned empty/null, try PUT to join the session (MPSD requires membership to read)
    if (!raw || !raw.properties) {
      console.log(`[Session]   GET returned empty/no properties. Trying PUT to join session...`);
      try {
        // MPSD requires a connection GUID when setting active=true
        const connectionId = crypto.randomUUID();
        raw = await this.xblRequest('PUT', url, {
          members: {
            me: {
              constants: { system: { initialize: true } },
              properties: { system: { active: true, connection: connectionId } },
            },
          },
        });
      } catch (err: any) {
        console.log(`[Session]   PUT (join) failed: ${err.message}`);
        return null;
      }
    }

    const rawStr = raw ? JSON.stringify(raw) : 'undefined';
    console.log(`[Session]   Session response (${rawStr.length} chars): ${rawStr.slice(0, 2000)}`);

    if (!raw) {
      console.log(`[Session]   Empty response from session API.`);
      return null;
    }

    const session = raw as SessionResponse;

    // Log session details
    const custom = session.properties?.custom;
    if (custom) {
      console.log(`[Session]   World: "${custom.worldName}" hosted by "${custom.hostName}"`);
      console.log(`[Session]   Version: ${custom.version}, Players: ${custom.MemberCount}/${custom.MaxMemberCount}`);
      console.log(`[Session]   LanGame: ${custom.LanGame}, Joinability: ${custom.Joinability}`);
      console.log(`[Session]   WebRTC: ${custom.UsesWebSocketsWebRTCSignaling}, NetherNet: ${custom.netherNetEnabled}`);

      if (custom.SupportedConnections && custom.SupportedConnections.length > 0) {
        console.log(`[Session]   Supported connections (${custom.SupportedConnections.length}):`);
        for (const conn of custom.SupportedConnections) {
          console.log(`[Session]     Type=${conn.ConnectionType} IP=${conn.HostIpAddress || '(none)'}:${conn.HostPort || 0} NetherNet=${conn.NetherNetId || 'n/a'} WebRTC=${conn.WebRTCNetworkId || 'n/a'}`);
        }
      } else {
        console.log(`[Session]   No SupportedConnections in session!`);
      }
    } else {
      console.log(`[Session]   Session has no custom properties.`);
    }

    return { session, sessionName };
  }

  /**
   * Find all friends who are hosting joinable Minecraft worlds.
   * If friendGamertag is specified, only look for that friend's world.
   */
  async findFriendWorlds(friendGamertag?: string): Promise<FriendWorld[]> {
    const friends = await this.getFriends();
    console.log(`[Session] Found ${friends.length} Xbox friends total.`);

    // Filter by gamertag if specified — search all friends regardless of online status
    let candidates: XboxFriend[];
    if (friendGamertag) {
      candidates = friends.filter(
        f => f.gamertag.toLowerCase() === friendGamertag.toLowerCase()
      );
      if (candidates.length === 0) {
        console.log(`[Session] WARNING: No friend found with gamertag "${friendGamertag}".`);
        console.log(`[Session] Available gamertags: ${friends.map(f => f.gamertag).join(', ')}`);
        return [];
      }
    } else {
      // If no specific friend, check online friends first
      candidates = friends.filter(f => f.presenceState === 'Online');
      if (candidates.length === 0) {
        console.log(`[Session] No friends are online. Checking all friends for sessions...`);
        candidates = friends;
      }
    }

    console.log(`[Session] Checking ${candidates.length} friend(s) for active Minecraft sessions...`);

    const worlds: FriendWorld[] = [];

    for (const friend of candidates) {
      const result = await this.getPlayerSession(friend.xuid);
      if (!result) continue;

      const { session, sessionName } = result;
      const custom = session.properties?.custom;
      if (!custom?.SupportedConnections || custom.SupportedConnections.length === 0) {
        console.log(`[Session] ${friend.gamertag} has a session but no SupportedConnections array.`);
        continue;
      }

      // Try to find a direct IP connection first
      let bestConn = custom.SupportedConnections.find(
        (c: SessionConnection) => c.HostIpAddress && c.HostPort > 0
      );

      // If no direct IP, take whatever is available (we'll log it)
      if (!bestConn) {
        bestConn = custom.SupportedConnections[0];
        console.log(`[Session] ${friend.gamertag}: No direct IP connection found. Best available: Type=${bestConn.ConnectionType}`);

        // If there's truly no IP, we can't connect via bedrock-protocol
        if (!bestConn.HostIpAddress || bestConn.HostPort <= 0) {
          console.log(`[Session] ${friend.gamertag}: Session uses WebRTC/NetherNet only — cannot connect directly.`);
          console.log(`[Session] TIP: If you're on the same network, try "type": "server" with the device's local IP instead.`);
          continue;
        }
      }

      worlds.push({
        hostGamertag: friend.gamertag,
        hostXuid: friend.xuid,
        worldName: custom.worldName || 'Unknown World',
        hostName: custom.hostName || friend.gamertag,
        version: custom.version || 'unknown',
        memberCount: custom.MemberCount || 0,
        maxMemberCount: custom.MaxMemberCount || 10,
        sessionName,
        ip: bestConn.HostIpAddress,
        port: bestConn.HostPort,
        connectionType: bestConn.ConnectionType,
      });
    }

    return worlds;
  }

  /**
   * Authenticate with Xbox Live (verifies cached tokens or triggers device code flow)
   */
  async authenticate(): Promise<void> {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  STEP 1: Sign in with the BOT account                      ║');
    console.log(`║  Email: ${this.config.bot.microsoftEmail.padEnd(51)}║`);
    console.log('║  This is the account the bot will use to play Minecraft.    ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    await this.authflow.getXboxToken('http://xboxlive.com');
    console.log('[Session] Bot account authentication successful!');

    if (this.hostAuthflow) {
      console.log('');
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║  STEP 2: Sign in with the HOST/FRIEND account              ║');
      console.log(`║  Email: ${this.config.connection.friendMicrosoftEmail.padEnd(51)}║`);
      console.log('║  This is YOUR account — the one hosting Minecraft on your   ║');
      console.log('║  phone. We use it to discover your world session.           ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('');

      await this.hostAuthflow.getXboxToken('http://xboxlive.com');
      console.log('[Session] Host account authentication successful!');
    }
  }
}
