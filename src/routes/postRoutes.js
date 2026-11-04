const express = require('express');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const cloudinary = require('../config/cloudinary');
const uploadImage = require('../middleware/imageUpload');
const Comment = require('../models/Comment');
const CommentVote = require('../models/CommentVote');
const Reaction = require('../models/Reaction');
const Vote = require('../models/Vote');
const Repost = require('../models/Repost');
const Game = require('../models/Game');
const Community = require('../models/Community');
const Membership = require('../models/Membership');
const { publicFeedFilter } = require('../services/postVisibility');
const rateLimit = require('../middleware/rateLimit');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const User = require('../models/User');
const SeenPost = require('../models/SeenPost');
const { getFriendIds } = require('../services/friends');
const { notify } = require('../services/notifications');
const { hasImageSignature } = require('../services/media');
const FeedServed = require('../models/FeedServed');
const FeedHide = require('../models/FeedHide');
const UserInterest = require('../models/UserInterest');
const { createFeedEngine } = require('../services/feedEngine');
const { recordSignal, recordViews } = require('../services/interests');

const feedEngine = createFeedEngine({
  Post, SeenPost, FeedServed, FeedHide, UserInterest, Membership, Community, Game, getFriendIds,
  Reaction, Repost, Comment, User,
});

const { blockedEitherWay } = require('../services/blocks');
const { getFollowingIds } = require('../services/follows');
const { isBlockedBetween } = require('../services/blocks');
const router = express.Router();

const validId = (id) => mongoose.Types.ObjectId.isValid(id);

const limitPosts = rateLimit({
  name: 'post',
  max: 20,
  windowMs: 15 * 60 * 1000,
});

const MAX_REPLY_DEPTH = 6;

const limitComments = rateLimit({
  name: 'comment',
  max: 50,
  windowMs: 15 * 60 * 1000,
});

async function findVisiblePost(id, req) {
  const post = await Post.findOne({
    _id: id,
    removedAt: null,
  }).lean();

  if (!post) return null;

  if (
    post.destinations.some((destination) =>
      ['general', 'game'].includes(destination.type)
    )
  ) {
    return post;
  }

  const communityDestinations = post.destinations.filter(
    (destination) => destination.type === 'community'
  );

  for (const destination of communityDestinations) {
    const community = await Community.findOne({
      slug: destination.target,
      active: true,
    })
      .select('_id visibility')
      .lean();

    if (community?.visibility === 'public') return post;

    if (
      community?.visibility === 'private' &&
      req.user &&
      await Membership.exists({
        community: community._id,
        user: req.user._id,
      })
    ) {
      return post;
    }
  }

  return null;
}

// POST /api/posts/seen  { ids: [postId, ...] }
const limitSeen = rateLimit({ name: 'post-seen', max: 60, windowMs: 15 * 60 * 1000 });

router.post('/seen', requireAuth, limitSeen, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const clean = [...new Set(ids.filter((id) => typeof id === 'string' && validId(id)))].slice(0, 50);

    if (!clean.length) {
      return res.json({ success: true, data: { recorded: 0 } });
    }

    // Only record posts that really exist.
    const existing = await Post.find({ _id: { $in: clean }, removedAt: null }).distinct('_id');
    const now = new Date();

    if (existing.length) {
      await SeenPost.bulkWrite(
        existing.map((id) => ({
          updateOne: {
            filter: { user: req.user._id, post: id },
            update: { $set: { seenAt: now }, $setOnInsert: { user: req.user._id, post: id } },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }

    if (existing.length) {
      // Posts that stayed on screen are a weak sign of interest.
      void Post.find({ _id: { $in: existing } })
        .select('author destinations')
        .lean()
        .then((rows) => recordViews(req.user._id, rows))
        .catch(() => {});
    }

    return res.json({ success: true, data: { recorded: existing.length } });
  } catch (error) {
    return next(error);
  }
});

// GET /api/posts
// The personal feed. The ranking lives in services/feedEngine.js.
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 20, 1),
      30
    );

    if (req.query.game && !/^[a-z0-9-]{2,60}$/.test(req.query.game)) {
      return res.status(400).json({ success: false, error: 'Invalid game filter.' });
    }

    const feed = typeof req.query.feed === 'string' ? req.query.feed : 'for-you';

    if (!['for-you', 'interests', 'friends', 'following'].includes(feed)) {
      return res.status(400).json({ success: false, error: 'Invalid feed.' });
    }

    if (feed === 'friends' && !req.query.game) {
      if (!req.user) {
        return res.json({ success: true, data: { items: [], nextCursor: null, unavailable: 'signin' } });
      }

      if (!(await getFriendIds(req.user._id)).length) {
        return res.json({ success: true, data: { items: [], nextCursor: null, unavailable: 'no-friends' } });
      }
    }

    if (feed === 'following' && !req.query.game) {
      if (!req.user) {
        return res.json({ success: true, data: { items: [], nextCursor: null, unavailable: 'signin' } });
      }

      if (!(await getFollowingIds(req.user._id)).length) {
        return res.json({ success: true, data: { items: [], nextCursor: null, unavailable: 'no-following' } });
      }
    }

    let page;

    try {
      page = await feedEngine.buildFeedPage({
        user: req.user || null,
        feed,
        game: req.query.game || null,
        limit,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
      });
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json({ success: false, error: error.message });
      }

      throw error;
    }

    const items = page.items;

    if (req.user && items.length) {
      const ids = items.map((post) => post._id);

      const [liked, reposted] = await Promise.all([
        Reaction.find({ user: req.user._id, post: { $in: ids } }).distinct('post'),
        Repost.find({ user: req.user._id, post: { $in: ids } }).distinct('post'),
      ]);

      const likedSet = new Set(liked.map(String));
      const repostedSet = new Set(reposted.map(String));

      for (const item of items) {
        item.liked = likedSet.has(String(item._id));
        item.reposted = repostedSet.has(String(item._id));
      }

      // Posts shared to a community are voted on like a subreddit post.
      const communityIds = items
        .filter((item) => (item.destinations || []).some((destination) => destination.type === 'community'))
        .map((item) => item._id);
      if (communityIds.length) {
        const votes = await Vote.find({ user: req.user._id, post: { $in: communityIds } }).select('post value').lean();
        const byPost = new Map(votes.map((vote) => [String(vote.post), vote.value]));
        for (const item of items) item.myVote = byPost.get(String(item._id)) || 0;
      }
    }

    return res.json({
      success: true,
      data: { items, nextCursor: page.nextCursor, caughtUp: page.caughtUp },
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/posts/trending
// "Trending in your circle": what friends and communities are reacting to right now.
router.get('/trending', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 6, 1), 10);
    const { items } = await feedEngine.trendingInCircle({ user: req.user || null, limit });

    if (req.user && items.length) {
      const ids = items.map((post) => post._id);
      const [liked, reposted] = await Promise.all([
        Reaction.find({ user: req.user._id, post: { $in: ids } }).distinct('post'),
        Repost.find({ user: req.user._id, post: { $in: ids } }).distinct('post'),
      ]);
      const likedSet = new Set(liked.map(String));
      const repostedSet = new Set(reposted.map(String));

      for (const item of items) {
        item.liked = likedSet.has(String(item._id));
        item.reposted = repostedSet.has(String(item._id));
      }
    }

    return res.json({ success: true, data: { items } });
  } catch (error) {
    return next(error);
  }
});

// Hide a post, show less like it, or mute its author.
const limitHide = rateLimit({ name: 'feed-hide', max: 120, windowMs: 15 * 60 * 1000 });

router.post('/:id/hide', requireAuth, limitHide, async (req, res, next) => {
  try {
    const mode = req.body?.mode;

    if (!validId(req.params.id) || !['post', 'less', 'author'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'Choose what to hide.' });
    }

    const post = await findVisiblePost(req.params.id, req);

    if (!post) {
      return res.status(404).json({ success: false, error: 'Post not found.' });
    }

    if (mode === 'author' && String(post.author) === String(req.user._id)) {
      return res.status(400).json({ success: false, error: 'You cannot mute yourself.' });
    }

    const keep = async (kind, target, expires) => {
      await FeedHide.updateOne(
        { user: req.user._id, kind, target },
        { $setOnInsert: { user: req.user._id, kind, target, expireAt: expires } },
        { upsert: true }
      );
    };
    const ninetyDays = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    await keep('post', post._id, ninetyDays);

    if (mode === 'author') await keep('author', post.author, null);

    void recordSignal(
      req.user._id,
      post,
      mode === 'author' ? 'muteAuthor' : mode === 'less' ? 'hideLess' : 'hidePost'
    );

    return res.json({
      success: true,
      data: { hidden: true, mode, author: String(post.author) },
    });
  } catch (error) {
    return next(error);
  }
});

// Undo a hide or a mute.
router.delete('/hidden/:kind/:id', requireAuth, async (req, res, next) => {
  try {
    if (!['post', 'author'].includes(req.params.kind) || !validId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Nothing to undo.' });
    }

    await FeedHide.deleteOne({
      user: req.user._id,
      kind: req.params.kind,
      target: req.params.id,
    });

    return res.json({ success: true, data: { undone: true } });
  } catch (error) {
    return next(error);
  }
});

// Players the signed-in user has muted.
router.get('/hidden/authors', requireAuth, async (req, res, next) => {
  try {
    const rows = await FeedHide.find({ user: req.user._id, kind: 'author' })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('target')
      .lean();
    const users = await User.find({ _id: { $in: rows.map((row) => row.target) } })
      .select('username displayName avatar')
      .lean();

    return res.json({ success: true, data: { items: users } });
  } catch (error) {
    return next(error);
  }
});

// GET /api/posts/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid post.',
      });
    }

    const visible = await findVisiblePost(req.params.id, req);

    const post = visible
      ? await Post.findById(visible._id)
          .populate('author', 'username displayName avatar')
          .lean()
      : null;

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found.',
      });
    }

    const comments = await Comment.find({ post: post._id })
      .sort({ _id: 1 })
      .limit(100)
      .populate('author', 'username displayName avatar')
      .lean();

    return res.json({
      success: true,
      data: {
        post,
        comments,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/posts
router.post(
  '/',
  requireAuth,
  limitPosts,
  uploadImage.postPhotos,
  async (req, res, next) => {
    let uploadedImages = [];

    try {
      const files = [...(req.files?.photos || []), ...(req.files?.photo || [])].slice(0, uploadImage.MAX_POST_PHOTOS);
      const body =
        typeof req.body?.body === 'string'
          ? req.body.body.trim()
          : '';

      let destinations = req.body?.destinations;

      // Multipart forms send destinations as a string.
      if (typeof destinations === 'string') {
        try {
          destinations = JSON.parse(destinations);
        } catch {
          return res.status(400).json({
            success: false,
            error: 'Invalid post destinations.',
          });
        }
      }

      // A post must contain text, an image, or both.
      if (!body && !files.length) {
        return res.status(400).json({
          success: false,
          error: 'Write something or add a photo.',
        });
      }

      if (body.length > 500) {
        return res.status(400).json({
          success: false,
          error: 'Post text cannot exceed 500 characters.',
        });
      }

      if (
        !Array.isArray(destinations) ||
        !destinations.length ||
        destinations.length > 5
      ) {
        return res.status(400).json({
          success: false,
          error: 'Choose at least one post destination.',
        });
      }

      // Check each file's real signature, not just its MIME type.
      for (const file of files) {
        if (!hasImageSignature(file.buffer)) {
          return res.status(400).json({
            success: false,
            error: 'One of the files is not a supported image.',
          });
        }
      }

      const normalized = [];

      for (const destination of destinations) {
        if (
          !destination ||
          !['general', 'game', 'community'].includes(destination.type)
        ) {
          return res.status(400).json({
            success: false,
            error: 'Invalid post destination.',
          });
        }

        if (destination.type === 'general') {
          if (destination.target != null) {
            return res.status(400).json({
              success: false,
              error: 'Invalid general destination.',
            });
          }

          normalized.push({ type: 'general' });
        } else if (destination.type === 'game') {
          if (
            typeof destination.target !== 'string' ||
            !/^[a-z0-9-]{2,60}$/.test(destination.target) ||
            !await Game.exists({
              slug: destination.target,
              active: true,
            })
          ) {
            return res.status(400).json({
              success: false,
              error: 'Choose an available game destination.',
            });
          }

          normalized.push({
            type: 'game',
            target: destination.target,
          });
        } else {
          if (
            typeof destination.target !== 'string' ||
            !/^[a-z0-9-]{2,60}$/.test(destination.target)
          ) {
            return res.status(400).json({
              success: false,
              error: 'Choose an available community destination.',
            });
          }

          const community = await Community.findOne({
            slug: destination.target,
            active: true,
          })
            .select('_id slug')
            .lean();

          if (
            !community ||
            !await Membership.exists({
              community: community._id,
              user: req.user._id,
            })
          ) {
            return res.status(403).json({
              success: false,
              error: 'Join each selected community before posting there.',
            });
          }

          normalized.push({
            type: 'community',
            target: community.slug,
          });
        }
      }

      const uniqueDestinations = new Set(
        normalized.map(
          (destination) =>
            `${destination.type}:${destination.target || ''}`
        )
      );

      if (uniqueDestinations.size !== normalized.length) {
        return res.status(400).json({
          success: false,
          error: 'Remove duplicate destinations.',
        });
      }

      // Upload the validated images to Cloudinary (in parallel, in the order chosen).
      const media = [];

      if (files.length) {
        cloudinary.ensureCloudinaryConfigured();

        const results = await Promise.allSettled(files.map((file) => new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: 'arcadia/posts',
              resource_type: 'image',
              allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
              transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
            },
            (error, result) => (error ? reject(error) : resolve(result))
          );

          stream.end(file.buffer);
        })));

        uploadedImages = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);

        const failed = results.find((r) => r.status === 'rejected');

        if (failed) throw failed.reason;

        for (const image of uploadedImages) {
          media.push({
            type: 'image',
            url: image.secure_url,
            publicId: image.public_id,
            width: image.width,
            height: image.height,
            format: image.format,
            bytes: image.bytes,
          });
        }
      }

      const post = await Post.create({
        author: req.user._id,
        body,
        destinations: normalized,
        media,
      });

      const communitySlugs = normalized
        .filter((destination) => destination.type === 'community')
        .map((destination) => destination.target);

      if (communitySlugs.length) {
        await Community.updateMany(
          { slug: { $in: communitySlugs } },
          { $inc: { postCount: 1 } }
        );
      }

      await post.populate('author', 'username displayName avatar');

      return res.status(201).json({
        success: true,
        data: { post },
      });
    } catch (error) {
      // Avoid leaving orphaned Cloudinary images if saving fails.
      for (const image of uploadedImages) {
        try {
          await cloudinary.uploader.destroy(image.public_id);
        } catch (cleanupError) {
          console.error(
            'Could not clean up an unsuccessful post image upload.',
            cleanupError.message
          );
        }
      }

      return next(error);
    }
  }
);

// POST /api/posts/:id/like
router.post('/:id/like', requireAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid post.',
      });
    }

    const post = await findVisiblePost(req.params.id, req);

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found.',
      });
    }

    const result = await Reaction.updateOne(
      {
        user: req.user._id,
        post: post._id,
      },
      {
        $setOnInsert: {
          user: req.user._id,
          post: post._id,
        },
      },
      { upsert: true }
    );

    if (result.upsertedCount) {
      await Post.updateOne(
        { _id: post._id },
        { $inc: { likeCount: 1 } }
      );

      await notify({
        recipient: post.author,
        actor: req.user._id,
        type: 'like',
        post: post._id,
        key: `like:${post._id}:${req.user._id}`,
      });

      void recordSignal(req.user._id, post, 'like');
    }

    const liked = await Reaction.exists({
      user: req.user._id,
      post: post._id,
    });

    return res.json({
      success: true,
      data: {
        liked: Boolean(liked),
        likeCount: await Reaction.countDocuments({
          post: post._id,
        }),
      },
    });
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/posts/:id/like
router.delete('/:id/like', requireAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid post.',
      });
    }

    const post = await findVisiblePost(req.params.id, req);

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found.',
      });
    }

    const result = await Reaction.deleteOne({
      user: req.user._id,
      post: req.params.id,
    });

    if (result.deletedCount) {
      await Post.updateOne(
        {
          _id: req.params.id,
          likeCount: { $gt: 0 },
        },
        { $inc: { likeCount: -1 } }
      );
    }

    return res.json({
      success: true,
      data: {
        liked: false,
        likeCount: await Reaction.countDocuments({
          post: req.params.id,
        }),
      },
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/posts/:id/repost
router.post('/:id/repost', requireAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid post.',
      });
    }

    const post = await findVisiblePost(req.params.id, req);

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found.',
      });
    }

    const result = await Repost.updateOne(
      {
        user: req.user._id,
        post: post._id,
      },
      {
        $setOnInsert: {
          user: req.user._id,
          post: post._id,
        },
      },
      { upsert: true }
    );

    if (result.upsertedCount) {
      await Post.updateOne(
        { _id: post._id },
        { $inc: { repostCount: 1 } }
      );

      await notify({
        recipient: post.author,
        actor: req.user._id,
        type: 'repost',
        post: post._id,
        key: `repost:${post._id}:${req.user._id}`,
      });

      void recordSignal(req.user._id, post, 'repost');
    }

    return res.json({
      success: true,
      data: {
        reposted: true,
        repostCount: await Repost.countDocuments({
          post: post._id,
        }),
      },
    });
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/posts/:id/repost
router.delete('/:id/repost', requireAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid post.',
      });
    }

    const post = await findVisiblePost(req.params.id, req);

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found.',
      });
    }

    const result = await Repost.deleteOne({
      user: req.user._id,
      post: req.params.id,
    });

    if (result.deletedCount) {
      await Post.updateOne(
        {
          _id: req.params.id,
          repostCount: { $gt: 0 },
        },
        { $inc: { repostCount: -1 } }
      );
    }

    return res.json({
      success: true,
      data: {
        reposted: false,
        repostCount: await Repost.countDocuments({
          post: req.params.id,
        }),
      },
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/posts/:id/comments
router.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid post.',
      });
    }

    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 30, 1),
      50
    );

    const commentQuery = { post: req.params.id };

    if (req.query.cursor) {
      if (!validId(req.query.cursor)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid pagination cursor.',
        });
      }

      commentQuery._id = { $gt: req.query.cursor };
    }

    const post = await findVisiblePost(req.params.id, req);

    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found.',
      });
    }

    const hiddenAuthors = await blockedEitherWay(req.user?._id);
    if (hiddenAuthors.length) commentQuery.author = { $nin: hiddenAuthors };

    const comments = await Comment.find(commentQuery)
      .sort({ _id: 1 })
      .limit(limit)
      .populate('author', 'username displayName avatar')
      .lean();

    const commentIds = comments.map((comment) => comment._id);
    const [tallies, mine] = commentIds.length
      ? await Promise.all([
        CommentVote.aggregate([{ $match: { comment: { $in: commentIds } } }, { $group: { _id: '$comment', score: { $sum: '$value' }, ups: { $sum: { $cond: [{ $eq: ['$value', 1] }, 1, 0] } } } }]),
        req.user ? CommentVote.find({ user: req.user._id, comment: { $in: commentIds } }).select('comment value').lean() : [],
      ])
      : [[], []];
    const tallyById = new Map(tallies.map((row) => [String(row._id), row]));
    const myById = new Map(mine.map((row) => [String(row.comment), row.value]));
    for (const comment of comments) {
      const tally = tallyById.get(String(comment._id));
      comment.score = tally ? tally.score : 0;
      comment.likeCount = tally ? tally.ups : 0;
      comment.myVote = myById.get(String(comment._id)) || 0;
    }

    const items = comments.map((comment) => (comment.deletedAt
      ? { _id: comment._id, post: comment.post, parent: comment.parent, createdAt: comment.createdAt, body: '[deleted]', author: null, deleted: true, score: 0, likeCount: 0, myVote: 0 }
      : comment));

    return res.json({
      success: true,
      data: {
        items,
        nextCursor:
          comments.length === limit
            ? String(comments.at(-1)._id)
            : null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/posts/:id/comments
router.post(
  '/:id/comments',
  requireAuth,
  limitComments,
  async (req, res, next) => {
    try {
      const body = req.body?.body;

      if (
        !validId(req.params.id) ||
        typeof body !== 'string' ||
        !body.trim() ||
        body.trim().length > 1000
      ) {
        return res.status(400).json({
          success: false,
          error: 'Enter a comment of up to 1,000 characters.',
        });
      }

      const post = await findVisiblePost(req.params.id, req);

      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found.',
        });
      }

      let parent = null;
      let parentAuthor = null;

      if (req.body.parent != null) {
        if (!validId(req.body.parent)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid reply target.',
          });
        }

        // Replies can go under any comment on this post (Reddit-style threads).
        // Threads stop getting deeper after MAX_REPLY_DEPTH; deeper replies sit at the last level.
        const parentComment = await Comment.findOne({
          _id: req.body.parent,
          post: post._id,
        })
          .select('_id author parent')
          .lean();

        if (!parentComment) {
          return res.status(400).json({
            success: false,
            error: 'That comment is no longer available to reply to.',
          });
        }

        let target = parentComment;
        let depth = 0;
        let cursor = parentComment;
        while (cursor.parent && depth < 50) {
          depth += 1;
          cursor = await Comment.findOne({ _id: cursor.parent, post: post._id }).select('_id parent').lean();
          if (!cursor) break;
        }
        if (depth >= MAX_REPLY_DEPTH - 1 && parentComment.parent) {
          target = await Comment.findOne({ _id: parentComment.parent, post: post._id }).select('_id author parent').lean() || parentComment;
        }
        parentAuthor = parentComment.author;

        parent = target._id;
      }

      const comment = await Comment.create({
        post: post._id,
        author: req.user._id,
        body: body.trim(),
        parent,
      });

      await Post.updateOne(
        { _id: post._id },
        { $inc: { commentCount: 1 } }
      );

      if (parentAuthor) {
        await notify({
          recipient: parentAuthor,
          actor: req.user._id,
          type: 'reply',
          post: post._id,
          comment: comment._id,
          key: `reply:${comment._id}`,
        });
      }

      if (!parentAuthor || String(parentAuthor) !== String(post.author)) {
        await notify({
          recipient: post.author,
          actor: req.user._id,
          type: 'comment',
          post: post._id,
          comment: comment._id,
          key: `comment:${comment._id}`,
        });
      }

      void recordSignal(req.user._id, post, 'comment');

      await comment.populate('author', 'username displayName avatar');

      return res.status(201).json({
        success: true,
        data: { comment },
      });
    } catch (error) {
      return next(error);
    }
  }
);

/* ----------------------- edit and delete ----------------------- */

const editLimit = rateLimit({ name: 'content-edit', max: 80, windowMs: 60 * 60 * 1000 });

// PATCH /api/posts/:id  { body?, title? }  (author only)
router.patch('/:id', requireAuth, editLimit, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid post.' });
    const post = await Post.findOne({ _id: req.params.id, removedAt: null });
    if (!post || post.type !== 'original') return res.status(404).json({ success: false, error: 'Post not found.' });
    if (String(post.author) !== String(req.user._id)) return res.status(403).json({ success: false, error: 'You can only edit your own posts.' });

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : post.body;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : post.title;
    if (body.length > 500) return res.status(400).json({ success: false, error: 'Post text cannot exceed 500 characters.' });
    if (title.length > 120) return res.status(400).json({ success: false, error: 'Titles can be up to 120 characters.' });
    if (!body && !title && !(post.media || []).length) return res.status(400).json({ success: false, error: 'A post needs some text or a photo.' });

    if (body !== post.body || title !== post.title) {
      post.body = body;
      post.title = title;
      post.editedAt = new Date();
      await post.save();
    }
    return res.json({ success: true, data: { post: { _id: String(post._id), body: post.body, title: post.title, editedAt: post.editedAt } } });
  } catch (error) { return next(error); }
});

// DELETE /api/posts/:id  (author only)
router.delete('/:id', requireAuth, editLimit, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid post.' });
    const post = await Post.findOne({ _id: req.params.id, removedAt: null }).select('author destinations').lean();
    if (!post) return res.status(404).json({ success: false, error: 'Post not found.' });
    if (String(post.author) !== String(req.user._id)) return res.status(403).json({ success: false, error: 'You can only delete your own posts.' });
    await Post.updateOne({ _id: post._id, removedAt: null }, { $set: { removedAt: new Date(), removedBy: req.user._id } });
    const slugs = (post.destinations || []).filter((item) => item.type === 'community' && item.target).map((item) => item.target);
    if (slugs.length) await Community.updateMany({ slug: { $in: slugs }, postCount: { $gt: 0 } }, { $inc: { postCount: -1 } });
    return res.json({ success: true, data: { removed: true } });
  } catch (error) { return next(error); }
});

// PATCH /api/posts/:id/comments/:commentId  { body }  (comment author only)
router.patch('/:id/comments/:commentId', requireAuth, editLimit, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.commentId)) return res.status(400).json({ success: false, error: 'Invalid comment.' });
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ success: false, error: 'A comment can’t be empty.' });
    if (body.length > 1000) return res.status(400).json({ success: false, error: 'Comments can be up to 1000 characters.' });
    const comment = await Comment.findOne({ _id: req.params.commentId, post: req.params.id, deletedAt: null });
    if (!comment) return res.status(404).json({ success: false, error: 'Comment not found.' });
    if (String(comment.author) !== String(req.user._id)) return res.status(403).json({ success: false, error: 'You can only edit your own comments.' });
    if (comment.body !== body) { comment.body = body; comment.editedAt = new Date(); await comment.save(); }
    return res.json({ success: true, data: { comment: { _id: String(comment._id), body: comment.body, editedAt: comment.editedAt } } });
  } catch (error) { return next(error); }
});

// DELETE /api/posts/:id/comments/:commentId  (comment author, or the post's author)
router.delete('/:id/comments/:commentId', requireAuth, editLimit, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.commentId)) return res.status(400).json({ success: false, error: 'Invalid comment.' });
    const [comment, post] = await Promise.all([
      Comment.findOne({ _id: req.params.commentId, post: req.params.id, deletedAt: null }).select('author').lean(),
      Post.findOne({ _id: req.params.id }).select('author').lean(),
    ]);
    if (!comment || !post) return res.status(404).json({ success: false, error: 'Comment not found.' });
    const mine = String(comment.author) === String(req.user._id);
    const owner = String(post.author) === String(req.user._id);
    if (!mine && !owner) return res.status(403).json({ success: false, error: 'You can’t delete this comment.' });
    const replies = await Comment.exists({ parent: comment._id, deletedAt: null });
    await Comment.updateOne({ _id: comment._id }, { $set: { deletedAt: new Date(), body: '[deleted]' } });
    await Post.updateOne({ _id: post._id, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });
    return res.json({ success: true, data: { deleted: true, hasReplies: Boolean(replies) } });
  } catch (error) { return next(error); }
});

// PUT /api/posts/:id/comments/:commentId/vote  { value: 1 | 0 | -1 }
// Feed comments can be liked (1) or unliked (0). Community comments also allow downvotes (-1).
const commentVoteLimit = rateLimit({ name: 'comment-vote', max: 200, windowMs: 60 * 60 * 1000 });

router.put('/:id/comments/:commentId/vote', requireAuth, commentVoteLimit, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.commentId)) return res.status(400).json({ success: false, error: 'Invalid comment.' });
    const value = Number(req.body?.value);
    if (![-1, 0, 1].includes(value)) return res.status(400).json({ success: false, error: 'Invalid vote.' });
    const [post, comment] = await Promise.all([
      Post.findOne({ _id: req.params.id, removedAt: null }).select('destinations').lean(),
      Comment.findOne({ _id: req.params.commentId, post: req.params.id, deletedAt: null }).select('author').lean(),
    ]);
    if (!post || !comment) return res.status(404).json({ success: false, error: 'Comment not found.' });
    if (String(comment.author) === String(req.user._id)) return res.status(400).json({ success: false, error: 'You can’t vote on your own comment.' });
    if (await isBlockedBetween(req.user._id, comment.author)) return res.status(403).json({ success: false, error: 'You can’t vote on this comment.' });
    const inCommunity = (post.destinations || []).some((item) => item.type === 'community');
    if (value === -1 && !inCommunity) return res.status(400).json({ success: false, error: 'Only community comments can be downvoted.' });

    if (value === 0) await CommentVote.deleteOne({ comment: comment._id, user: req.user._id });
    else await CommentVote.updateOne({ comment: comment._id, user: req.user._id }, { $set: { value, post: post._id } }, { upsert: true });

    const [tally] = await CommentVote.aggregate([{ $match: { comment: comment._id } }, { $group: { _id: null, score: { $sum: '$value' }, ups: { $sum: { $cond: [{ $eq: ['$value', 1] }, 1, 0] } } } }]);
    return res.json({ success: true, data: { score: tally ? tally.score : 0, likeCount: tally ? tally.ups : 0, myVote: value } });
  } catch (error) { return next(error); }
});

module.exports = router;
