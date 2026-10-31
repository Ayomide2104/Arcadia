const DailyActive = require('../models/DailyActive');

// Remember in memory that we already recorded this user today, so a busy
// user causes one small database write per day, not one per request.
const recordedDay = new Map();

function today() {
  return new Date().toISOString().slice(0, 10);
}

function recordActivity(userId) {
  try {
    if (!userId) return;
    const id = String(userId);
    const day = today();
    if (recordedDay.get(id) === day) return;
    if (recordedDay.size > 50000) recordedDay.clear();
    recordedDay.set(id, day);

    DailyActive.updateOne(
      { day, user: userId },
      { $setOnInsert: { day, user: userId, createdAt: new Date() } },
      { upsert: true }
    ).catch((error) => console.warn('Could not record activity:', error.message));
  } catch (error) {
    console.warn('Could not record activity:', error.message);
  }
}

module.exports = { recordActivity, today };
