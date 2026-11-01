// Tiny in-memory stand-ins for the Mongoose models, just enough for the feed engine.
const idOf = (value) => String(value?._id ?? value);

function get(doc, path) { return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc); }

function matchField(value, cond) {
  const isOps = cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((key) => key.startsWith('$'));
  if (!isOps) {
    if (cond === null) return value == null;
    if (Array.isArray(value)) return value.map(idOf).includes(idOf(cond));
    return idOf(value) === idOf(cond);
  }
  return Object.entries(cond).every(([op, arg]) => {
    const list = Array.isArray(value) ? value : [value];
    if (op === '$in') return list.some((item) => arg.map(idOf).includes(idOf(item)));
    if (op === '$nin') return !list.some((item) => arg.map(idOf).includes(idOf(item)));
    if (op === '$ne') return idOf(value) !== idOf(arg);
    if (op === '$gte') return value >= arg;
    if (op === '$gt') return value > arg;
    if (op === '$lt') return value < arg;
    if (op === '$elemMatch') return Array.isArray(value) && value.some((element) => matches(element, arg));
    throw new Error(`fake does not support ${op}`);
  });
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$and') return cond.every((part) => matches(doc, part));
    if (key === '$or') return cond.some((part) => matches(doc, part));
    return matchField(get(doc, key), cond);
  });
}

class Query {
  constructor(rows) { this.rows = rows; }
  sort(spec) {
    const entries = Object.entries(spec || {});
    this.rows = [...this.rows].sort((a, b) => {
      for (const [key, dir] of entries) {
        const x = get(a, key); const y = get(b, key);
        if (x === y) continue;
        const cmp = (x instanceof Date || y instanceof Date) ? new Date(x) - new Date(y) : (x > y ? 1 : -1);
        if (cmp) return cmp * dir;
      }
      return 0;
    });
    return this;
  }
  limit(n) { this.rows = this.rows.slice(0, n); return this; }
  select() { return this; }
  lean() { return this; }
  then(resolve, reject) { return Promise.resolve(this.rows.map((row) => ({ ...row }))).then(resolve, reject); }
}

function fakeModel(rows) {
  return {
    rows,
    find: (filter = {}) => new Query(rows.filter((row) => matches(row, filter))),
    findOne: (filter = {}) => new Query(rows.filter((row) => matches(row, filter)).slice(0, 1)).then((list) => list[0] || null) && { lean: async () => rows.find((row) => matches(row, filter)) || null },
    deleteMany: async (filter) => { for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i], filter)) rows.splice(i, 1); },
    bulkWrite: async (ops) => {
      for (const { updateOne } of ops) {
        let row = rows.find((candidate) => matches(candidate, updateOne.filter));
        if (!row && updateOne.upsert) { row = { ...updateOne.update.$setOnInsert }; rows.push(row); }
        if (row) Object.assign(row, updateOne.update.$set || {});
      }
    },
    populate: async (docs, options) => { for (const doc of docs) doc[options.path] = { _id: doc[options.path], username: `u${idOf(doc[options.path]).slice(-3)}` }; return docs; }
  };
}

module.exports = { fakeModel, matches };
