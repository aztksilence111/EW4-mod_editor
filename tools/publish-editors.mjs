import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, createReadStream, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import https from 'node:https';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const repo = 'aztksilence111/EW4-mod_editor';
const [action = 'inspect', version = JSON.parse(readFileSync(resolve(root, 'package.json'))).version] = process.argv.slice(2);
if (!['inspect', 'publish', 'verify'].includes(action)) throw Error('Use inspect, publish or verify');
// Same Windows Git Credential Manager flow as o4mod/tools/github_release.cjs. Never log credentials.
const credential = execFileSync('git', ['credential', 'fill'], { cwd: root,
  input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
const token = credential.split(/\r?\n/).find(p => p.startsWith('password='))?.slice(9);
if (!token) throw Error('GitHub credential unavailable');
async function request(route, method = 'GET', body, upload) {
  const url = new URL(route.startsWith('https:') ? route : 'https://api.github.com' + route);
  if (!['api.github.com', 'uploads.github.com'].includes(url.hostname)) throw Error('Unexpected GitHub host');
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, lookup: (host, options, done) => {
      const address = host === 'uploads.github.com' ? '20.205.243.161' : '20.205.243.168';
      done(null, options.all ? [{ address, family: 4 }] : address, 4);
    }, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'ew4-editor-release', 'X-GitHub-Api-Version': '2022-11-28',
      ...(upload ? { 'Content-Type': 'application/octet-stream', 'Content-Length': statSync(upload).size } : data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) } }, response => {
      const chunks = []; response.on('data', p => chunks.push(p)); response.on('end', () => {
        const text = Buffer.concat(chunks).toString(); let value; try { value = JSON.parse(text) } catch { value = text }
        if (response.statusCode < 200 || response.statusCode >= 300) reject(Error(`GitHub ${method} ${url.pathname}: HTTP ${response.statusCode} ${JSON.stringify(value).slice(0, 240)}`));
        else resolve(value);
      });
    });
    req.setTimeout(60000, () => req.destroy(Error('GitHub request timeout'))); req.on('error', reject);
    if (upload) createReadStream(upload).pipe(req); else req.end(data);
  });
}
if (action === 'inspect') {
  const repository = await request('/repos/' + repo);
  const releases = await request('/repos/' + repo + '/releases?per_page=5');
  console.log(JSON.stringify({ repo: repository.full_name, defaultBranch: repository.default_branch, canPush: repository.permissions?.push,
    releases: releases.map(p => ({ tag: p.tag_name, draft: p.draft, url: p.html_url })) }));
} else {
  const directory = resolve(root, 'release', version);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json')));
  const names = [...manifest.files.map(f => f.name), 'manifest.json', 'SHA256SUMS.txt', 'verification.json'];
  for (const file of manifest.files) {
    if (file.name.includes('/') || file.name.includes('\\')) throw Error('Invalid artifact name');
    const path = resolve(directory, file.name); const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (statSync(path).size !== file.bytes || hash.digest('hex') !== file.sha256) throw Error('Artifact checksum mismatch: ' + file.name);
  }
  const tag = 'v' + version + '-' + (process.env.EW4_RELEASE_DATE || '20261111');
  const releases = await request('/repos/' + repo + '/releases?per_page=30');
  let release = releases.find(p => p.tag_name === tag);
  if (action === 'publish') {
    const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    // Ensure the release tag points to the uploaded editor source rather than an older default branch.
    await request('/repos/' + repo + '/git/commits/' + source);
    const body = readFileSync(resolve(root, 'docs', 'RELEASE_' + version + '.md'), 'utf8');
    if (!release) release = await request('/repos/' + repo + '/releases', 'POST', { tag_name: tag, target_commitish: source, name: 'EW4 Mod Editor ' + version, body, draft: true, prerelease: false });
    for (const name of names) {
      const previous = release.assets.find(p => p.name === name);
      if (previous) {
        const file = manifest.files.find(f => f.name === name);
        if (file && previous.size === file.bytes && previous.digest === 'sha256:' + file.sha256) continue;
        if (!release.draft) throw Error('Refusing to replace a published release asset: ' + name);
        await request('/repos/' + repo + '/releases/assets/' + previous.id, 'DELETE');
      }
      await request(release.upload_url.split('{')[0] + '?name=' + encodeURIComponent(name), 'POST', undefined, resolve(directory, name));
      console.log('Uploaded ' + name);
    }
    release = await request('/repos/' + repo + '/releases/' + release.id);
    for (const file of manifest.files) {
      const asset = release.assets.find(a => a.name === file.name);
      if (!asset || asset.size !== file.bytes || asset.digest !== 'sha256:' + file.sha256) throw Error('Remote artifact checksum mismatch: ' + file.name);
    }
    release = await request('/repos/' + repo + '/releases/' + release.id, 'PATCH', { draft: false, body, make_latest: 'true' });
  }
  if (!release || release.draft) throw Error('Published release not found');
  for (const file of manifest.files) {
    const asset = release.assets.find(a => a.name === file.name);
    if (!asset || asset.size !== file.bytes || asset.digest !== 'sha256:' + file.sha256) throw Error('Remote artifact mismatch: ' + file.name);
  }
  const result = { url: release.html_url, tag: release.tag_name, files: release.assets.map(a => ({ name: a.name, bytes: a.size, digest: a.digest, url: a.browser_download_url })) };
  writeFileSync(resolve(directory, 'github-release.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
