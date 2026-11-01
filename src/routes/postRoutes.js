const express = require('express');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const cloudinary = require('../config/cloudinary');
const uploadImage = require('../middleware/imageUpload');
const Comment = require('../models/Comment');
const Reaction = require('../models/Reaction');
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
const FeedServed = require('../models/FeedServed');
const FeedHide = require('../models/FeedHide');
const UserInterest = require('../models/UserInterest');
const { createFeedEngine } = require('../services/feedEngine');
const { recordSignal, recordViews } = require('../services/interests');

const feedEngine = createFeedEngine({
  Post, SeenPost, FeedServed, FeedHide, UserInterest, Membership, Community, Game, getFriendIds,
});

const router = express.Router();

const validId = (id) => mongoose.Types.ObjectId.isValid(id);

const limitPosts = rateLimit({
  name: 'post',
  max: 20,
  windowMs: 15 * 60 * 1000,
});

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

    if (!['for-you', 'interests', 'friends'].includes(feed)) {
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
    }

    return res.json({
      success: true,
      data: { items, nextCursor: page.nextCursor, caughtUp: page.caughtUp },
    });
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
  uploadImage.single('photo'),
  async (req, res, next) => {
    let uploadedImage = null;

    try {
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
      if (!body && !req.file) {
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

      // Validate the actual file signature, not just its MIME type.
      if (req.file) {
        const buffer = req.file.buffer;

        const isJpeg =
          buffer.length >= 3 &&
          buffer[0] === 0xff &&
          buffer[1] === 0xd8 &&
          buffer[2] === 0xff;

        const isPng =
          buffer.length >= 8 &&
          buffer.subarray(0, 8).equals(
            Buffer.from([
              0x89, 0x50, 0x4e, 0x47,
              0x0d, 0x0a, 0x1a, 0x0a,
            ])
          );

        const isGif =
          buffer.length >= 6 &&
          ['GIF87a', 'GIF89a'].includes(
            buffer.subarray(0, 6).toString('ascii')
          );

        const isWebp =
          buffer.length >= 12 &&
          buffer.toString('ascii', 0, 4) === 'RIFF' &&
          buffer.toString('ascii', 8, 12) === 'WEBP';

        if (!(isJpeg || isPng || isGif || isWebp)) {
          return res.status(400).json({
            success: false,
            error: 'The uploaded file is not a supported image.',
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

      // Upload the validated image to Cloudinary.
      const media = [];

      if (req.file) {
        // Ensure Cloudinary credentials are configured before uploading.
        cloudinary.ensureCloudinaryConfigured();

        uploadedImage = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: 'arcadia/posts',
              resource_type: 'image',
              allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
              transformation: [
                {
                  width: 1600,
                  height: 1600,
                  crop: 'limit',
                },
              ],
            },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );

          stream.end(req.file.buffer);
        });

        media.push({
          type: 'image',
          url: uploadedImage.secure_url,
          publicId: uploadedImage.public_id,
          width: uploadedImage.width,
          height: uploadedImage.height,
          format: uploadedImage.format,
          bytes: uploadedImage.bytes,
        });
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
      // Avoid leaving an orphaned Cloudinary image if saving fails.
      if (uploadedImage?.public_id) {
        try {
          await cloudinary.uploader.destroy(uploadedImage.public_id);
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

    const comments = await Comment.find(commentQuery)
      .sort({ _id: 1 })
      .limit(limit)
      .populate('author', 'username displayName avatar')
      .lean();

    return res.json({
      success: true,
      data: {
        items: comments,
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

        const parentComment = await Comment.findOne({
          _id: req.body.parent,
          post: post._id,
          parent: null,
        })
          .select('_id author')
          .lean();

        if (!parentComment) {
          return res.status(400).json({
            success: false,
            error:
              'Replies can only target a top-level comment on this post.',
          });
        }

        parent = parentComment._id;
        parentAuthor = parentComment.author;
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

module.exports = router;
