const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test.local') });
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Friendship = require('../src/models/Friendship');
const Game = require('../src/models/Game');
const Community = require('../src/models/Community');
const Membership = require('../src/models/Membership');
const Post = require('../src/models/Post');
const { connectTestDatabase } = require('./helpers/mongoTarget');

test('isolated Mongo social flows enforce authentication, idempotency, visibility, and session security', async (t) => {
  await connectTestDatabase(mongoose);
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = 'http://localhost:5174';
  async function request(path, { method = 'GET', body, auth, csrf = true } = {}) {
    const headers = { Origin: origin };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) { headers.Cookie = auth.cookie; if (csrf && !['GET','HEAD'].includes(method)) headers['X-CSRF-Token'] = auth.csrf; }
    const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { response, json: await response.json() };
  }
  async function register(username) {
    const { response, json } = await request('/api/auth/register', { method: 'POST', body: { username, password: 'secure-integration-password' } });
    assert.equal(response.status, 201, JSON.stringify(json));
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: json.data.csrfToken, user: json.data.user };
  }
  try {
    await t.test('guest actions are blocked and cross-site writes fail', async () => {
      const me = await request('/api/auth/me');
      assert.equal(me.response.status, 200);
      assert.deepEqual(me.json, { user: null });
      const guest = await request('/api/posts', { method: 'POST', body: { body: 'blocked', destinations: [{ type: 'general' }] } });
      assert.equal(guest.response.status, 401);
      const noOrigin = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'no_origin', password: 'secure-integration-password' }) });
      assert.equal(noOrigin.status, 403);
    });

    await t.test('registration reports validation and duplicate username or email conflicts', async () => {
      const username = `duplicate_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const email = `${randomUUID()}@example.invalid`;
      const first = await request('/api/auth/register', { method: 'POST', body: { username, email, password: 'secure-integration-password' } });
      assert.equal(first.response.status, 201);
      const duplicateName = await request('/api/auth/register', { method: 'POST', body: { username, password: 'secure-integration-password' } });
      assert.equal(duplicateName.response.status, 409);
      const duplicateEmail = await request('/api/auth/register', { method: 'POST', body: { username: `${username}_alt`, email, password: 'secure-integration-password' } });
      assert.equal(duplicateEmail.response.status, 409);
      const invalid = await request('/api/auth/register', { method: 'POST', body: { username: `${username}_invalid`, email: 'bad-email', password: 'secure-integration-password' } });
      assert.equal(invalid.response.status, 400);
    });

    await t.test('likes, unlikes, reposts, comments, and replies persist idempotently', async () => {
      const auth = await register(`integration_${randomUUID().replaceAll('-', '').slice(0, 16)}`);
      const created = await request('/api/posts', { method: 'POST', auth, body: { body: 'A general post', destinations: [{ type: 'general' }] } });
      assert.equal(created.response.status, 201);
      const id = created.json.data.post._id;
      for (let i = 0; i < 2; i++) assert.equal((await request(`/api/posts/${id}/like`, { method: 'POST', auth })).json.data.likeCount, 1);
      for (let i = 0; i < 2; i++) assert.equal((await request(`/api/posts/${id}/like`, { method: 'DELETE', auth })).json.data.likeCount, 0);
      for (let i = 0; i < 2; i++) assert.equal((await request(`/api/posts/${id}/repost`, { method: 'POST', auth })).json.data.repostCount, 1);
      for (let i = 0; i < 2; i++) assert.equal((await request(`/api/posts/${id}/repost`, { method: 'DELETE', auth })).json.data.repostCount, 0);
      const comment = await request(`/api/posts/${id}/comments`, { method: 'POST', auth, body: { body: 'Top-level comment' } });
      assert.equal(comment.response.status, 201);
      const reply = await request(`/api/posts/${id}/comments`, { method: 'POST', auth, body: { body: 'Reply', parent: comment.json.data.comment._id } });
      assert.equal(reply.response.status, 201);
      assert.equal(reply.json.data.comment.parent, comment.json.data.comment._id);
      const detail = await request(`/api/posts/${id}`);
      assert.equal(detail.json.data.comments.length, 2);
      const badCsrf = await request(`/api/posts/${id}/like`, { method: 'POST', auth, csrf: false });
      assert.equal(badCsrf.response.status, 403);
    });

    await t.test('community-only posts remain scoped and members alone may publish', async () => {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
      const auth = await register(`community_${suffix}`);
      const game = await Game.create({ slug: `test-game-${suffix}`, name: 'Test Game', genres: ['fps'], active: true });
      assert.ok(game);
      const communitySlug = `test-lobby-${suffix}`;
      const community = await Community.create({ slug: communitySlug, name: 'Test Lobby', rules: ['Be kind'], active: true, visibility: 'public' });
      const denied = await request(`/api/communities/${communitySlug}/posts`, { method: 'POST', auth, body: { body: 'Not joined' } });
      assert.equal(denied.response.status, 403);
      await Membership.create({ community: community._id, user: auth.user.id, role: 'owner' });
      const posted = await request(`/api/communities/${communitySlug}/posts`, { method: 'POST', auth, body: { body: 'Only in this lobby' } });
      assert.equal(posted.response.status, 201);
      const id = posted.json.data.post._id;
      assert.equal((await request('/api/posts')).json.data.items.some((post) => post._id === id), false);
      assert.equal((await request(`/api/posts/${id}`)).response.status, 200);
      const page = await request(`/api/communities/${communitySlug}/posts`, { auth });
      assert.equal(page.json.data.items.some((post) => post._id === id), true);
      assert.deepEqual(page.json.data.rules, ['Be kind']);
      const privateSlug = `private-lobby-${suffix}`;
      const privateCommunity=await Community.create({slug:privateSlug,name:'Private Lobby',visibility:'private',active:true});
      await Membership.create({community:privateCommunity._id,user:auth.user.id,role:'member'});
      const privatePost=await Post.create({author:auth.user.id,body:'Private to members',destinations:[{type:'community',target:privateCommunity.slug}]});
      assert.equal((await request(`/api/posts/${privatePost._id}`)).response.status,404);
      assert.equal((await request(`/api/posts/${privatePost._id}`,{auth})).response.status,200);
    });

    await t.test('general feed pagination can reach posts beyond the first 200 candidates', async () => {
      const auth = await register(`feedpage_${randomUUID().replaceAll('-', '').slice(0, 16)}`);
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const baseTime = Date.now();
      const records = Array.from({ length: 215 }, (_, index) => ({
        author: auth.user.id,
        body: `Pagination regression ${suffix} ${index}`,
        destinations: [{ type: 'general' }],
        createdAt: new Date(baseTime - (214 - index) * 60_000),
        updatedAt: new Date(baseTime - (214 - index) * 60_000),
      }));
      const created = await Post.insertMany(records);
      const expectedIds = new Set(created.map((post) => String(post._id)));
      const foundIds = new Set();
      let cursor = null;
      let pages = 0;

      do {
        const path = `/api/posts?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page = await request(path);
        assert.equal(page.response.status, 200, JSON.stringify(page.json));
        for (const post of page.json.data.items) foundIds.add(String(post._id));
        cursor = page.json.data.nextCursor;
        pages += 1;
        assert.ok(pages <= 20, 'pagination should terminate instead of looping indefinitely');
      } while (cursor);

      assert.ok([...expectedIds].every((id) => foundIds.has(id)), 'all 215 inserted posts should be reachable');
    });

    await t.test('public profile serializer is allow-listed and password change revokes other sessions', async () => {
      const username = `settings_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const first = await register(username);
      const secondLogin = await request('/api/auth/login', { method: 'POST', body: { username, password: 'secure-integration-password' } });
      const second = { cookie: secondLogin.response.headers.get('set-cookie').split(';')[0], csrf: secondLogin.json.data.csrfToken };
      await User.updateOne({ username }, { $set: { email: 'private@example.invalid', settings: { secret: true } } });
      const profile = await request(`/api/auth/profiles/${username}`);
      assert.equal(profile.json.data.user.email, undefined);
      assert.equal(profile.json.data.user.settings, undefined);
      const publicPost=await request('/api/posts',{method:'POST',auth:first,body:{body:'Public profile post',destinations:[{type:'general'}]}});
      assert.equal(publicPost.response.status,201);
      const recent=await request(`/api/auth/profiles/${username}/posts`);
      assert.equal(recent.json.data.items[0]._id,publicPost.json.data.post._id);
      assert.deepEqual(Object.keys(recent.json.data.items[0].author).sort(),['_id','avatar','displayName','username']);
      await User.updateOne({username},{$set:{privacy:{profileVisibility:'private',friendRequests:'everyone'}}});
      assert.equal((await request(`/api/auth/profiles/${username}`)).response.status,404);
      assert.equal((await request(`/api/auth/profiles/${username}`,{auth:first})).response.status,200);
      const changed = await request('/api/auth/password', { method: 'POST', auth: first, body: { currentPassword: 'secure-integration-password', newPassword: 'a-different-secure-password' } });
      assert.equal(changed.response.status, 200);
      assert.deepEqual((await request('/api/auth/me', { auth: second })).json.user, null);
      assert.equal((await request('/api/auth/me', { auth: first })).response.status, 200);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
});
