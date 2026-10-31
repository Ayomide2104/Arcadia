const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsername, validateRegistration, serializePublicUser } = require('../src/services/socialContracts');
const User = require('../src/models/User');

test('registration normalizes usernames and enforces username and password rules', () => {
  assert.equal(normalizeUsername('  Mixed_Case  '), 'mixed_case');
  assert.deepEqual(validateRegistration({ username: 'Player_1', password: 'long-enough-pass' }), { valid: true, username: 'player_1' });
  assert.deepEqual(validateRegistration({ username: 'Player_1', email: ' PLAYER@example.invalid ', password: 'long-enough-pass' }), { valid: true, username: 'player_1', email: 'player@example.invalid' });
  assert.equal(validateRegistration({ username: 'Player_1', email: 'not-an-email', password: 'long-enough-pass' }).valid, false);
  assert.equal(validateRegistration({ username: 'no', password: 'long-enough-pass' }).valid, false);
  assert.equal(validateRegistration({ username: 'fine', password: 'short' }).valid, false);
  assert.equal(validateRegistration({ username: { $ne: '' }, password: 'long-enough-pass' }).valid, false);
  assert.equal(validateRegistration(['player', 'password']).valid, false);
});

test('public profile serializer omits credentials, settings, and private fields', () => {
  const createdAt = new Date('2025-01-01T00:00:00Z');
  const serialized = serializePublicUser({
    _id: 'user-id', username: 'player', displayName: 'Player', createdAt,
    passwordHash: 'must-not-leak', email: 'private@example.invalid', settings: { secret: true }, sessionData: 'private'
  });
  assert.deepEqual(serialized, { id: 'user-id', username: 'player', displayName: 'Player', bio: '', avatar: null, banner: null, genres: [], favoriteGames: [], createdAt, onboardingComplete: false });
  assert.doesNotMatch(JSON.stringify(serialized), /passwordHash|email|settings|sessionData|must-not-leak/);
});

test('username and email indexes apply only to string-valued fields', () => {
  const indexes = User.schema.indexes();
  const username = indexes.find(([key]) => key.username === 1);
  const email = indexes.find(([key]) => key.email === 1);
  assert.equal(username[1].unique, true);
  assert.deepEqual(username[1].partialFilterExpression, { username: { $type: 'string' } });
  assert.equal(email[1].unique, true);
  assert.deepEqual(email[1].partialFilterExpression, { email: { $type: 'string' } });
  assert.equal(User.schema.options.autoIndex, false);
});
