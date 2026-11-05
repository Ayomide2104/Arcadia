const express = require('express');
const Game = require('../models/Game');
const AdminAction = require('../models/AdminAction');
const uploadImage = require('../middleware/imageUpload');
const cloudinary = require('../config/cloudinary');
const { hasImageSignature } = require('../services/media');

// Mounted at /api/admin/games (admin sign-in is already required by adminRoutes).
const router = express.Router();

const slugify = (name) => String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const list = (value, max = 8, size = 30) => {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean).map((item) => item.slice(0, size)))].slice(0, max);
};
const fail = (res, status, error) => res.status(status).json({ success: false, error });

function shape(game) {
  return {
    slug: game.slug, name: game.name, genres: game.genres || [], platforms: game.platforms || [], description: game.description || '',
    accent: game.accent, aliases: game.aliases || [], active: game.active !== false, coverUrl: game.coverUrl || '', bannerUrl: game.bannerUrl || '',
    popularity: game.popularity || 0, createdAt: game.createdAt,
  };
}

async function uploadArt(file, kind) {
  if (!file) return null;
  if (!hasImageSignature(file.buffer)) throw Object.assign(new Error('One of the files is not a supported image.'), { status: 400 });
  cloudinary.ensureCloudinaryConfigured();
  const size = kind === 'banner' ? { width: 1600, height: 900 } : { width: 800, height: 1100 };
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'arcadia/games', resource_type: 'image', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'], transformation: [{ ...size, crop: 'limit' }] },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(file.buffer);
  });
}

const destroy = async (publicId) => { if (publicId) { try { await cloudinary.uploader.destroy(publicId); } catch { /* best effort */ } } };

router.get('/', async (req, res, next) => {
  try {
    const games = await Game.find({}).sort({ name: 1 }).lean();
    res.json({ success: true, data: { items: games.map(shape) } });
  } catch (error) { next(error); }
});

function readFields(body) {
  const name = String(body.name ?? '').trim();
  const accent = String(body.accent ?? '').trim();
  return {
    name,
    genres: list(body.genres, 6),
    platforms: list(body.platforms, 6),
    aliases: list(body.aliases, 6, 60),
    description: String(body.description ?? '').trim().slice(0, 300),
    accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '',
  };
}

router.post('/', uploadImage.gameArt, async (req, res, next) => {
  const added = [];
  try {
    const fields = readFields(req.body || {});
    if (fields.name.length < 2 || fields.name.length > 80) return fail(res, 400, 'Give the game a name (2 to 80 characters).');
    const slug = slugify(fields.name);
    if (!slug) return fail(res, 400, 'That name can’t be turned into a link. Use letters or numbers.');
    if (await Game.exists({ slug })) return fail(res, 409, 'A game with that name already exists.');

    const [cover, banner] = await Promise.all([uploadArt(req.files?.cover?.[0], 'cover'), uploadArt(req.files?.banner?.[0], 'banner')]);
    if (cover) added.push(cover.public_id);
    if (banner) added.push(banner.public_id);

    const game = await Game.create({
      slug, name: fields.name, genres: fields.genres, platforms: fields.platforms, aliases: fields.aliases, description: fields.description,
      accent: fields.accent || undefined,
      coverUrl: cover?.secure_url || '', coverPublicId: cover?.public_id || '',
      bannerUrl: banner?.secure_url || '', bannerPublicId: banner?.public_id || '',
    });
    await AdminAction.create({ action: 'game_add', targetType: 'game', targetId: String(game._id), targetLabel: game.name, summary: { slug } });
    res.status(201).json({ success: true, data: { game: shape(game) } });
  } catch (error) {
    for (const id of added) await destroy(id);
    next(error);
  }
});

router.patch('/:slug', uploadImage.gameArt, async (req, res, next) => {
  const added = [];
  try {
    const game = await Game.findOne({ slug: String(req.params.slug).toLowerCase() });
    if (!game) return fail(res, 404, 'Game not found.');
    const body = req.body || {};
    const fields = readFields({ ...game.toObject(), ...body });
    if (fields.name.length < 2 || fields.name.length > 80) return fail(res, 400, 'Give the game a name (2 to 80 characters).');

    const [cover, banner] = await Promise.all([uploadArt(req.files?.cover?.[0], 'cover'), uploadArt(req.files?.banner?.[0], 'banner')]);
    if (cover) added.push(cover.public_id);
    if (banner) added.push(banner.public_id);

    const oldIds = [];
    game.name = fields.name;
    game.genres = Object.hasOwn(body, 'genres') ? fields.genres : game.genres;
    game.platforms = Object.hasOwn(body, 'platforms') ? fields.platforms : game.platforms;
    game.aliases = Object.hasOwn(body, 'aliases') ? fields.aliases : game.aliases;
    game.description = Object.hasOwn(body, 'description') ? fields.description : game.description;
    if (fields.accent) game.accent = fields.accent;
    if (Object.hasOwn(body, 'active')) game.active = body.active === true || body.active === 'true';
    if (cover) { oldIds.push(game.coverPublicId); game.coverUrl = cover.secure_url; game.coverPublicId = cover.public_id; }
    if (banner) { oldIds.push(game.bannerPublicId); game.bannerUrl = banner.secure_url; game.bannerPublicId = banner.public_id; }
    await game.save();
    for (const id of oldIds) await destroy(id);
    await AdminAction.create({ action: 'game_edit', targetType: 'game', targetId: String(game._id), targetLabel: game.name, summary: { active: game.active } });
    res.json({ success: true, data: { game: shape(game) } });
  } catch (error) {
    for (const id of added) await destroy(id);
    next(error);
  }
});

module.exports = router;
