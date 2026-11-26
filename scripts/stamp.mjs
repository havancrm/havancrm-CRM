// Stamps ONE version string into version.js, sw.js, index.html (cache-busting) from package.json (+ short git hash).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
let hash = ''; try { hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
const v = process.env.APP_VERSION || `${pkg.version}${hash ? '+' + hash : '+local'}`;
const sub = (f, re, rep) => { const s = fs.readFileSync(f, 'utf8'); const n = s.replace(re, rep); if (n !== s) fs.writeFileSync(f, n); };
sub('public/js/version.js', /VERSION = '[^']*'/, `VERSION = '${v}'`);
sub('public/sw.js', /const VERSION = '[^']*'/, `const VERSION = '${v}'`);
sub('public/index.html', /\?v=[^"']*/g, `?v=${v}`);
// server reports the same version (checked by tests)
sub('src/server/index.js', /const VERSION = '[^']*'/, `const VERSION = '${v}'`);
console.log('stamped', v);
