# What changed, file by file (for merging with your own edits)

If you've fixed things by hand, compare these files against your copy rather than replacing them.
Before each hand-off, `npm run smoke` is run: it loads `js/main.js` against a fake page and fails on
start-up order mistakes such as "Cannot access '$' before initialization".

## Files that already existed and were edited
Front end: `index.html`, `js/main.js`, `js/communities.js`, `js/feedExtras.js`, `js/messaging.js`,
`js/composer.js` (now exports `prepareImage`), `js/notifications.js`, `js/share.js`, `js/trendingGames.js`,
`js/circle.js`, `admin/admin.js`, `package.json` (added the `smoke` script).
Back end: `src/app.js`, `src/socket.js`, `src/routes/{postRoutes,messageRoutes,communityRoutes,notificationRoutes,adminRoutes,friendRequestRoutes,authRoutes}.js`,
`src/models/{Post,Comment,Message,Notification}.js`, `src/services/{feedEngine,feedRanking,notifications,accountDeletion}.js`.

## New files (nothing of yours is overwritten by these)
Front end: `js/{search,commentThread,lfg,drawer,safety,social,popover,viewport,pullRefresh,confirm,postManage}.js`,
`css/{arcadia-fixes,arcadia-lfg,arcadia-drawer,arcadia-safety,arcadia-social}.css`.
Back end: `src/config/{lfgGames,origins}.js`, `src/middleware/jsonGzip.js`,
`src/models/{Lfg,LfgRequest,Block,Report,Follow,PostShare,CommentVote}.js`,
`src/routes/{searchRoutes,lfgRoutes,safetyRoutes,followRoutes,pointsRoutes}.js`,
`src/services/{blocks,follows,arcadianPoints,pointsMath,postPhotos}.js`.
Other: `scripts/smoke*.mjs`, `tests/{lfgConfig,arcadianPoints}.test.js`.

## Latest round
- Fixed: `mountPoints: $('#view-points')` ran before `$` existed (main.js). It now uses `document.querySelector`.
- Chat: reply to a message, delete for me, delete for everyone, delete a whole chat (`messageRoutes.js`, `Message.js`, `messaging.js`).
- Community posts accept photos (`communityRoutes.js`, `postPhotos.js`, `communities.js`, `composer.js`).
- ⋯ menu and pull-to-refresh made more tap-safe (`popover.js`, `pullRefresh.js`).

## Round after that
- Fonts: `css/arcadia-fonts.css` (declares fonts from `public/fonts`), `js/fonts.js` (catalogue, free vs store tiers, Settings picker); `index.html` links the css and preloads Plus Jakarta Sans; `main.js` calls `initFonts()` and adds a Fonts card in Settings.
- Full-page community chat: `communities.js` (body class `cc-full`, back buttons), styles at the end of `css/arcadia-fixes.css`.

## Round: loading screen, admin games and site controls
- Launch screen and slow-load indicator: `css/arcadia-splash.css` (first stylesheet), `js/loading.js`; `index.html` has the `#splash` block at the top of `<body>`; `main.js` wraps `api()` (now `apiCore()` underneath) so slow requests show a bar after 250ms and a card after 1s.
- Admin: Games page (add/edit/hide games with cover and banner upload) and Site page (announcement banner, pause sign-ups): `admin/admin.js`, `src/routes/adminGameRoutes.js`, `src/routes/adminRoutes.js` (`/site`), `src/models/SiteSetting.js`, `src/services/siteSettings.js`, `src/routes/siteRoutes.js`, `src/middleware/imageUpload.js` (`gameArt`), `src/models/Game.js` (cover/banner fields).
- Games added by an admin get artwork through `/api/games/art/:slug/:kind`; `getArcadiaGame()` in `main.js` points unknown games there. Built-in games are unchanged.
- App side: `js/siteBanner.js`; `authRoutes.js` register route honours the sign-ups switch.
