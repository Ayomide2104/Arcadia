const Notification = require('../models/Notification');
const { isBlockedBetween } = require('./blocks');
const User = require('../models/User');

// Which account preference switches a notification type off.
const PREFERENCE = { comment: 'comments', reply: 'comments', like: 'reactions', repost: 'reactions' };

/**
 * Create a notification. Never throws: a failed notification must not break
 * the action (like, comment, friend request) that caused it.
 */
async function notify({ recipient, actor, type, post = null, comment = null, lfg = null, key }) {
  if (actor && recipient && await isBlockedBetween(recipient, actor)) return null;
  try {
    if (!recipient || !actor || !key) return false;
    if (String(recipient) === String(actor)) return false;

    const preference = PREFERENCE[type];
    if (preference) {
      const target = await User.findById(recipient).select('notificationPreferences').lean();
      if (!target) return false;
      if (target.notificationPreferences && target.notificationPreferences[preference] === false) return false;
    }

    const result = await Notification.updateOne(
      { recipient, key },
      { $setOnInsert: { recipient, actor, type, post, comment, lfg, key, readAt: null, createdAt: new Date() } },
      { upsert: true }
    );
    return Boolean(result.upsertedCount);
  } catch (error) {
    console.warn('Could not create a notification:', error.message);
    return false;
  }
}

module.exports = { notify };
