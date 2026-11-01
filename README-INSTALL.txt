ARCADIA DROP-IN UPDATE 2
========================
Apply AFTER the first drop-in (arcadia-dropin.zip). Copy these over your project
root and replace when asked. Paths mirror your project.

Fixes in this update:
  - Joining a community no longer makes you its owner
  - Feed "Communities" tab now shows posts from the communities you joined
  - Dark theme: top bar icon buttons, composer, buttons, feed tabs, active nav item
  - "communties" typo in the search label
  - Game list now loads up to 100 games (was 50)
New tool:
  node scripts/setCommunityRole.js <community-slug> <username> <owner|moderator|member>
  e.g. node scripts/setCommunityRole.js arcadia mkstudios owner

No seed needed again. Restart:  npm.cmd run dev:all
