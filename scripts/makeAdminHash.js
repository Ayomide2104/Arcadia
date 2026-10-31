/* Creates the secure "fingerprint" (bcrypt hash) of your admin password.
 *
 *   npm.cmd run admin:hash
 *
 * Type a password when asked (it is hidden). Copy the ADMIN_PASSWORD_HASH line
 * into your .env file and into Render's Environment settings. The password
 * itself is never saved anywhere.
 */
const readline = require('node:readline');
const bcrypt = require('bcryptjs');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(question)) process.stdout.write(text); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const first = await askHidden('Choose an admin password (12+ characters): ');
  if (first.length < 12) {
    console.error('That is too short. Use at least 12 characters (a few random words works well).');
    process.exit(1);
  }
  const second = await askHidden('Type it again: ');
  if (first !== second) {
    console.error('The two passwords did not match. Run the command again.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(first, 12);
  console.log('\nAdd these two lines to your .env file (keep the single quotes) and to Render > Environment:\n');
  console.log('ADMIN_USERNAME=choose-a-username');
  console.log(`ADMIN_PASSWORD_HASH='${hash}'`);
  console.log('\nOn Render, paste the hash WITHOUT the quotes. Then restart the server.');
})();
