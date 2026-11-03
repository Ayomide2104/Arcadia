/*
 * Looking For Gamers: how each game actually lets people team up.
 *
 * Every game has its own way in (an Epic name, a Riot ID, a room code with a
 * password, a Stardew invite code, ...). Players pick the method that fits the
 * game when they post, so the form asks for the right thing and checks its
 * format. The value is only shown to people the host accepts.
 *
 * This file is the single source of truth: the API validates against it and
 * the front end builds the form from it (GET /api/lfg/options).
 *
 * Sources checked while building this list: Epic Games help (Fortnite),
 * ConcernedApe/Stardew Valley 1.6 notes and guides (invite codes), Garena
 * Free Fire and PUBG Mobile custom-room guides (Room Card, room ID + password).
 * Other games use their publisher's standard player ID. Every game also gets
 * "Message me on Arcadia" so nobody is ever blocked by a wrong guess.
 */

const SKILLS = [
  { key: 'any', label: 'Any level' },
  { key: 'beginner', label: 'Beginner friendly' },
  { key: 'casual', label: 'Casual' },
  { key: 'competitive', label: 'Competitive' },
];

const DURATIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 3, label: '3 hours' },
  { hours: 6, label: '6 hours' },
  { hours: 12, label: '12 hours' },
  { hours: 24, label: '24 hours' },
];

const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch', 'Mobile'];

// Links are only accepted from these hosts, so an invite field can't be used for phishing.
const LINK_HOSTS = [
  'roblox.com', 'www.roblox.com', 'ro.blox.com',
  'realms.gg', 'minecraft.net', 'www.minecraft.net',
  'discord.gg', 'discord.com', 'aka.ms', 'xbox.com', 'www.xbox.com',
  'steamcommunity.com', 's.team', 'epicgames.com', 'www.epicgames.com',
];

const DM = { key: 'dm', label: 'Message me on Arcadia', kind: 'dm', secret: false, help: 'Players you accept can message you here.' };

const text = (key, label, placeholder, extra = {}) => ({ key, label, kind: 'id', secret: true, placeholder, min: 2, max: 40, ...extra });
const code = (key, label, placeholder, extra = {}) => ({ key, label, kind: 'code', secret: true, placeholder, min: 3, max: 60, ...extra });
const link = (key, label, placeholder, help) => ({ key, label, kind: 'link', secret: true, placeholder, max: 200, help });

const RIOT_ID = text('riot-id', 'Riot ID', 'Name#TAG', { pattern: '^.{3,16}#[A-Za-z0-9]{3,5}$', patternHint: 'Use the format Name#TAG, for example Alex#NG1.' });
const BATTLE_TAG = text('battletag', 'BattleTag', 'Name#1234', { pattern: '^[^\\s#]{3,12}#\\d{3,8}$', patternHint: 'Use the format Name#1234.' });
const ACTIVISION = text('activision-id', 'Activision ID', 'Name#1234567', { pattern: '^.{2,30}#\\d{4,10}$', patternHint: 'Use the format Name#1234567.' });
const EPIC = text('epic-name', 'Epic display name', 'Your Epic name');
const EA_ID = text('ea-id', 'EA ID / platform name', 'Your EA ID or console/PC name');
const XBOX = text('gamertag', 'Xbox gamertag', 'Your gamertag', { max: 20 });
const STEAM = text('steam', 'Steam friend code or name', 'Friend code or profile name');
const UBISOFT = text('ubisoft', 'Ubisoft Connect name', 'Your Ubisoft Connect name');
const PLATFORM_NAME = text('platform-name', 'Platform name (PSN / Xbox / PC)', 'Your name on that platform');
const GAME_UID = (key, label, hint) => text(key, label, hint, { pattern: '^\\d{6,14}$', patternHint: 'This should be numbers only.', max: 14 });

const GAMES = {
  'fc-mobile': { platforms: ['Mobile'], modes: ['Head to Head', 'VS Attack', 'Friendly match', 'League / club'], methods: [text('fc-name', 'In-game name / ID', 'Your FC Mobile name')] },
  'ea-sports-fc': { platforms: ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch'], modes: ['Ultimate Team', 'Pro Clubs', 'Online friendlies', 'Co-op seasons'], methods: [EA_ID] },
  'call-of-duty': { platforms: ['PC', 'PlayStation', 'Xbox'], modes: ['Multiplayer', 'Warzone', 'Zombies', 'Ranked'], methods: [ACTIVISION] },
  'call-of-duty-mobile': { platforms: ['Mobile'], modes: ['Multiplayer', 'Battle Royale', 'Ranked', 'Private match'], methods: [GAME_UID('codm-uid', 'Player UID', 'Your UID'), code('codm-room', 'Private match room code', 'Room code')] },
  'pubg-mobile': {
    platforms: ['Mobile'], modes: ['Classic squad', 'Classic duo', 'Arena / TDM', 'Ranked', 'Custom room'],
    methods: [text('pubg-id', 'Character name / ID', 'Your PUBG Mobile name or ID'), code('pubg-room', 'Custom room: ID + password', 'Room ID / password', { help: 'Creating a custom room needs a Room Card in your inventory.' })],
  },
  'fortnite': { platforms: PLATFORMS, modes: ['Battle Royale', 'Zero Build', 'Ranked', 'Creative / islands'], methods: [EPIC, link('fortnite-link', 'Invite link', 'https://…', 'Only links from trusted sites are accepted.')] },
  'minecraft': {
    platforms: ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch', 'Mobile'], modes: ['Survival', 'Creative', 'Minigames / server', 'Realm', 'Hardcore'],
    methods: [text('mc-name', 'Java username / Xbox gamertag', 'Your Minecraft name'), code('mc-server', 'Server address (IP)', 'play.example.com', { help: 'Java and Bedrock use different addresses and ports; say which in your note.' }), link('mc-realm', 'Realm invite link', 'https://realms.gg/…', 'Realm invites are links.')],
  },
  'gta-v': { platforms: ['PC', 'PlayStation', 'Xbox'], modes: ['Free roam', 'Heists', 'Missions', 'Roleplay', 'Races'], methods: [PLATFORM_NAME, text('rockstar', 'Rockstar Social Club name', 'Your Social Club name')] },
  'valorant': { platforms: ['PC', 'PlayStation', 'Xbox'], modes: ['Competitive', 'Premier', 'Unrated', 'Swiftplay', 'Spike Rush', 'Custom game'], methods: [RIOT_ID] },
  'apex-legends': { platforms: ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch'], modes: ['Battle Royale trios', 'Ranked', 'Duos', 'Mixtape'], methods: [EA_ID] },
  'league-of-legends': { platforms: ['PC'], modes: ['Ranked Flex', 'Draft', 'ARAM', 'Arena', 'Custom game'], methods: [RIOT_ID] },
  'rocket-league': {
    platforms: ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch'], modes: ['Casual 3v3', 'Ranked 2v2', 'Ranked 3v3', 'Rumble / extra modes', 'Private match'],
    methods: [EPIC, code('rl-private', 'Private match: name + password', 'Name / password')],
  },
  'roblox': { platforms: ['PC', 'Mobile', 'Xbox', 'PlayStation'], modes: ['Any experience (say which in your note)', 'Private server'], methods: [text('roblox-name', 'Roblox username', 'Your username'), link('roblox-private', 'Private server link', 'https://www.roblox.com/…', 'Only roblox.com links are accepted.')] },
  'genshin-impact': { platforms: ['PC', 'PlayStation', 'Mobile'], modes: ['Co-op domains', 'Bosses', 'Exploration', 'Spiral Abyss'], methods: [GAME_UID('genshin-uid', 'Genshin UID', '9-digit UID')] },
  'elden-ring': { platforms: ['PC', 'PlayStation', 'Xbox'], modes: ['Co-op (summon)', 'Boss help', 'Invasions', 'Colosseum'], methods: [code('er-password', 'Co-op password', 'Group password', { help: 'Players with the same password are matched in the game.' }), PLATFORM_NAME] },
  'overwatch-2': { platforms: ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch'], modes: ['Competitive', 'Quick play', 'Arcade', 'Custom game'], methods: [BATTLE_TAG] },
  'rainbow-six-siege': { platforms: ['PC', 'PlayStation', 'Xbox'], modes: ['Ranked', 'Unranked', 'Standard', 'Arcade'], methods: [UBISOFT] },
  'forza-horizon-5': { platforms: ['PC', 'Xbox', 'PlayStation'], modes: ['Convoy', 'Playground games', 'Eliminator', 'Racing'], methods: [XBOX] },
  'tekken-8': { platforms: ['PC', 'PlayStation', 'Xbox'], modes: ['Ranked', 'Player match lobby', 'Casual / practice', 'Arcade'], methods: [PLATFORM_NAME, code('tekken-lobby', 'Lobby / room ID', 'Lobby ID')] },
  'the-sims-4': { platforms: ['PC', 'PlayStation', 'Xbox'], modes: ['Gallery sharing', 'Challenges / legacy', 'Storytelling / roleplay'], methods: [EA_ID] },
  'among-us': { platforms: ['PC', 'Mobile', 'Nintendo Switch', 'PlayStation', 'Xbox'], modes: ['Classic', 'Hide n Seek', 'Custom rules'], methods: [code('among-code', 'Room code', 'ABCDEF', { pattern: '^[A-Za-z]{4,6}$', patternHint: 'Room codes are 4 to 6 letters.', min: 4, max: 6, help: 'Also say the server region in your note (North America, Europe or Asia).' })] },
  'stardew-valley': {
    platforms: ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch', 'Mobile'], modes: ['Co-op farm', 'Challenge / speedrun', 'Social / trading'],
    methods: [code('stardew-invite', 'Invite code', 'Invite code from the host menu', { pattern: '^[A-Za-z0-9_-]{4,64}$', patternHint: 'Invite codes use letters and numbers only.', help: 'Host: Options, then Multiplayer, then Show Invite Code. Everyone needs the same game version.' }), STEAM, code('stardew-ip', 'IP address (LAN or direct)', 'IP address', { help: 'Direct connection; the host needs an open port.' })],
  },
  'dota-2': { platforms: ['PC'], modes: ['Ranked', 'Unranked', 'Turbo', 'Custom lobby'], methods: [STEAM, code('dota-lobby', 'Lobby name + password', 'Name / password')] },
  'efootball': { platforms: ['Mobile', 'PC', 'PlayStation', 'Xbox'], modes: ['Online match', 'Co-op', 'Room match', 'Events'], methods: [text('efootball-id', 'eFootball / Konami ID', 'Your ID'), code('efootball-room', 'Room ID', 'Room ID')] },
  'free-fire': {
    platforms: ['Mobile'], modes: ['Battle Royale', 'Clash Squad', 'Custom room', 'Ranked'],
    methods: [GAME_UID('ff-uid', 'Player UID', 'Your Free Fire UID'), code('ff-room', 'Custom room: ID + password', 'Room ID / password', { help: 'Creating a custom room needs a Room Card.' })],
  },
  'asphalt-legends-unite': { platforms: ['Mobile', 'PC', 'Nintendo Switch', 'PlayStation', 'Xbox'], modes: ['Multiplayer race', 'Club', 'Friendly race'], methods: [text('asphalt-name', 'In-game name / club tag', 'Your name or club')] },
};

const GENERIC = {
  platforms: PLATFORMS,
  modes: ['Casual', 'Ranked / competitive', 'Co-op', 'Custom game'],
  methods: [text('player-name', 'In-game name / ID', 'Your player name'), code('room-code', 'Room / invite code', 'Code')],
};

function gameConfig(slug) {
  const entry = GAMES[slug] || GENERIC;
  const methods = [...entry.methods.map((method) => ({ ...method })), { ...DM }];
  return { slug, known: Boolean(GAMES[slug]), platforms: entry.platforms, modes: entry.modes, methods };
}

function allConfigs() {
  const out = {};
  for (const slug of Object.keys(GAMES)) out[slug] = gameConfig(slug);
  out._default = gameConfig('_default');
  return out;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * Check a join value against the chosen method. Returns { ok, value, error }.
 */
function validateJoin(slug, methodKey, rawValue) {
  const config = gameConfig(slug);
  const method = config.methods.find((item) => item.key === methodKey);
  if (!method) return { ok: false, error: 'Pick how players should join you.' };
  if (method.kind === 'dm') return { ok: true, method, value: '' };

  const value = String(rawValue ?? '').replace(CONTROL, '').trim();
  const min = method.min ?? 2;
  const max = method.max ?? 60;
  if (value.length < min) return { ok: false, error: `Enter your ${method.label.toLowerCase()}.` };
  if (value.length > max) return { ok: false, error: `${method.label} can be at most ${max} characters.` };
  if (method.pattern && !new RegExp(method.pattern).test(value)) return { ok: false, error: method.patternHint || `Check your ${method.label.toLowerCase()}.` };

  if (method.kind === 'link') {
    let url;
    try { url = new URL(value); } catch { return { ok: false, error: 'Paste the full link, starting with https://' }; }
    if (url.protocol !== 'https:' || !LINK_HOSTS.includes(url.hostname.toLowerCase())) {
      return { ok: false, error: 'That link isn’t from a supported site. Use the code or name option instead.' };
    }
    return { ok: true, method, value: url.toString() };
  }
  if (/https?:\/\//i.test(value)) return { ok: false, error: 'Links aren’t allowed here. Share a code or name instead.' };
  return { ok: true, method, value };
}

module.exports = { SKILLS, DURATIONS, PLATFORMS, GAMES, gameConfig, allConfigs, validateJoin };
