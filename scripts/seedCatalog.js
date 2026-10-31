require('dotenv').config();
const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/db');
const Game = require('../src/models/Game');
const Community = require('../src/models/Community');

const games = [
  ['fc-mobile','FC Mobile',['sports','football'],'#53dcaa'],['ea-sports-fc','EA SPORTS FC',['sports','football'],'#72d6ad'],
  ['call-of-duty','Call of Duty',['fps','tactical-shooter'],'#d5a66b'],['pubg-mobile','PUBG Mobile',['battle-royale','shooter'],'#e8ad6a'],
  ['fortnite','Fortnite',['battle-royale','casual'],'#a991ff'],['minecraft','Minecraft',['adventure','simulation'],'#79c76a'],
  ['gta-v','GTA V',['action','adventure'],'#e09a78'],['valorant','VALORANT',['fps','tactical-shooter'],'#ff8193'],
  ['apex-legends','Apex Legends',['battle-royale','fps'],'#ee8075'],['league-of-legends','League of Legends',['strategy','rpg'],'#8ca7f2'],
  ['rocket-league','Rocket League',['sports','racing'],'#74c8f4'],['roblox','Roblox',['casual','adventure'],'#e7e8ee'],
  ['genshin-impact','Genshin Impact',['rpg','adventure'],'#8ad8ad'],['elden-ring','Elden Ring',['rpg','action-rpg'],'#d2ac76'],
  ['overwatch-2','Overwatch 2',['fps','action'],'#f6c273'],['rainbow-six-siege','Rainbow Six Siege',['fps','tactical-shooter'],'#84b6e9'],
  ['forza-horizon-5','Forza Horizon 5',['racing','simulation'],'#65d6c1'],['tekken-8','Tekken 8',['fighting','action'],'#f17f80'],
  ['the-sims-4','The Sims 4',['simulation','casual'],'#77d4a6'],['among-us','Among Us',['casual','party'],'#e989a6'],
  ['stardew-valley','Stardew Valley',['simulation','adventure'],'#9fd276'],['dota-2','Dota 2',['strategy','rpg'],'#e37b73'],
  ['efootball','eFootball',['sports','football'],'#5fb4f0'],['free-fire','Free Fire',['battle-royale','shooter'],'#f2994a'],
  ['call-of-duty-mobile','Call of Duty: Mobile',['fps','tactical-shooter'],'#d5a66b'],['asphalt-legends-unite','Asphalt Legends Unite',['racing','arcade'],'#ef6a6a']
].map(([slug,name,genres,accent]) => ({ slug,name,genres,accent,platforms:[],description:`Find players and conversations for ${name}.`,aliases:[],active:true }));
const GENRE_LABELS = {
  sports: 'Sports', fps: 'FPS', rpg: 'RPG', 'battle-royale': 'Battle Royale', racing: 'Racing',
  strategy: 'Strategy', fighting: 'Fighting', simulation: 'Simulation', adventure: 'Adventure', party: 'Party Games'
};
const GENRE_ACCENTS = {
  sports: '#53dcaa', fps: '#ff8193', rpg: '#8ca7f2', 'battle-royale': '#e8ad6a', racing: '#65d6c1',
  strategy: '#e37b73', fighting: '#f17f80', simulation: '#79c76a', adventure: '#e09a78', party: '#e989a6'
};
const FLAIRS = ['Discussion', 'Clip', 'Question', 'Guide'];

// One community per game, and one per genre. Founders can still create their own.
const gameCommunities = games.map(({ slug, name, genres, accent }) => ({
  slug: slug === 'gta-v' ? 'gta' : slug, name, game: slug, games: [slug], genres,
  description: `The official ${name} community on Arcadia: tips, clips and squads.`, accent, official: true
}));
const genreCommunities = Object.entries(GENRE_LABELS).map(([id, label]) => ({
  slug: `genre-${id}`, name: `${label} Lounge`, game: null, games: [], genres: [id],
  description: `Everything ${label.toLowerCase()}: recommendations, squads and hot takes.`, accent: GENRE_ACCENTS[id]
}));
const communities = [
  ...gameCommunities,
  ...genreCommunities,
  { slug:'arcadia',name:'Arcadia',game:null,games:[],genres:[],description:'The official home of Arcadia: news, feedback, new features and a warm welcome.',accent:'#8b7df6', official: true },
  { slug:'general-gaming',name:'General Gaming',game:null,games:[],genres:[],description:'A lobby for everything you play.',accent:'#68d6bd' }
].map((community) => ({ ...community, rules: ['Keep it friendly.','No spam or harassment.','Stay on topic.'], flairs: FLAIRS, visibility:'public',active:true }));

async function seed() {
  try {
    await connectDatabase();
    for (const game of games) await Game.updateOne({ slug: game.slug }, { $set: game, $setOnInsert: { popularity: 0 } }, { upsert:true });
    for (const community of communities) {
      const { games: focus, genres, flairs, official, ...rest } = community;
      // Focus and flairs are refreshed on every run; owner, rules and counts are left alone.
      await Community.updateOne({ slug: community.slug }, { $set: { games: focus, genres, flairs, official: Boolean(official) }, $setOnInsert: { ...rest, memberCount:0 } }, { upsert:true });
    }
    console.info(`Catalog upserted: ${games.length} games, ${communities.length} communities.`);
  } finally { await mongoose.disconnect(); }
}
seed().catch(() => { console.error('Catalog seed failed. Check database connectivity and catalog model validation.'); process.exitCode = 1; });
