const test = require('node:test');
const assert = require('node:assert/strict');
const { allConfigs, gameConfig, validateJoin, DURATIONS, SKILLS } = require('../src/config/lfgGames');

test('every catalog game has platforms, modes and a DM fallback', () => {
  const configs = allConfigs();
  assert.ok(Object.keys(configs).length >= 27);
  for (const [slug, config] of Object.entries(configs)) {
    assert.ok(config.platforms.length > 0, `${slug} platforms`);
    assert.ok(config.modes.length > 0, `${slug} modes`);
    assert.ok(config.methods.some((method) => method.key === 'dm'), `${slug} has a DM option`);
    const keys = config.methods.map((method) => method.key);
    assert.equal(new Set(keys).size, keys.length, `${slug} method keys are unique`);
  }
});

test('unknown games fall back to a generic config', () => {
  const config = gameConfig('some-new-game');
  assert.equal(config.known, false);
  assert.ok(config.methods.length >= 2);
});

test('format checks follow each game', () => {
  assert.equal(validateJoin('valorant', 'riot-id', 'Alex#NG1').ok, true);
  assert.equal(validateJoin('valorant', 'riot-id', 'Alex').ok, false);
  assert.equal(validateJoin('overwatch-2', 'battletag', 'Alex#12345').ok, true);
  assert.equal(validateJoin('call-of-duty', 'activision-id', 'Alex#1234567').ok, true);
  assert.equal(validateJoin('genshin-impact', 'genshin-uid', '812345678').ok, true);
  assert.equal(validateJoin('genshin-impact', 'genshin-uid', 'abc').ok, false);
  assert.equal(validateJoin('among-us', 'among-code', 'ABCDEF').ok, true);
  assert.equal(validateJoin('among-us', 'among-code', 'ABC123').ok, false);
  assert.equal(validateJoin('free-fire', 'ff-uid', '1234567890').ok, true);
});

test('a method from a different game is rejected', () => {
  assert.equal(validateJoin('valorant', 'battletag', 'Alex#1234').ok, false);
  assert.equal(validateJoin('valorant', 'nope', 'x').ok, false);
});

test('DM needs no value and always works', () => {
  assert.deepEqual(validateJoin('fortnite', 'dm', '').ok, true);
  assert.equal(validateJoin('some-new-game', 'dm', '').ok, true);
});

test('links only from trusted hosts, https only', () => {
  assert.equal(validateJoin('minecraft', 'mc-realm', 'https://realms.gg/abc123').ok, true);
  assert.equal(validateJoin('minecraft', 'mc-realm', 'https://evil.example/abc').ok, false);
  assert.equal(validateJoin('minecraft', 'mc-realm', 'http://realms.gg/abc').ok, false);
  assert.equal(validateJoin('roblox', 'roblox-private', 'https://www.roblox.com/share?code=abc&type=Server').ok, true);
});

test('plain text fields reject links and control characters', () => {
  assert.equal(validateJoin('fortnite', 'epic-name', 'see https://evil.example').ok, false);
  const result = validateJoin('fortnite', 'epic-name', 'Player\u0000One');
  assert.equal(result.ok, true);
  assert.equal(result.value, 'PlayerOne');
});

test('durations and skills are sane', () => {
  assert.ok(DURATIONS.every((item) => item.hours >= 1 && item.hours <= 24));
  assert.ok(SKILLS.some((item) => item.key === 'any'));
});
