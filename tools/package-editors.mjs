import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, renameSync, readdirSync, lstatSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { editorHome } from './editor-home.mjs';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'))).version;
const home = editorHome(root);
const release = join(root, 'release', version);
if (existsSync(release) && (!process.argv.includes('--refresh') || !existsSync(join(release, 'manifest.json')) || existsSync(join(release, 'web/editor-home/author.json'))))
  throw Error('Release directory exists. Refresh requires --refresh, an existing manifest, and no author draft in the distribution.');
if (!existsSync(join(home, 'rewrite/player/story-player.js'))) throw Error('Run npm run setup:r3 with the current R source first.');
const run = (file, args) => execFileSync(file, args, { cwd: root, stdio: 'inherit' });
run(process.execPath, ['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit', '-p', 'tsconfig.app.json']);
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.node.json']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
mkdirSync(release, { recursive: true });
const desktop = join(release, 'web');
run('dotnet', ['publish', 'bridge/Ew4.Editor.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
  '-p:RewriteSnapshot=' + join(home, 'rewrite'), '-o', join(desktop, 'server'), '-v:q']);
const publishedAssets = join(desktop, 'server/wwwroot/assets');
if (lstatSync(publishedAssets).isSymbolicLink()) throw Error('Published assets must be a regular directory.');
const currentAssets = new Set(readdirSync(join(root, 'dist/assets')));
for (const name of readdirSync(publishedAssets))
  if (/^index-[\w-]+\.(js|css)(\.(br|gz))?$/.test(name) && !currentAssets.has(name.replace(/\.(br|gz)$/, '')) && lstatSync(join(publishedAssets, name)).isFile()) unlinkSync(join(publishedAssets, name));
for (const path of ['rewrite/data', 'rewrite/player', 'baseline.json']) cpSync(join(home, path), join(desktop, 'editor-home', path), { recursive: true });
writeFileSync(join(desktop, 'Start-Editor.cmd'), '@echo off\r\ncd /d "%~dp0"\r\nset "EW4_EDITOR_HOME=%~dp0editor-home"\r\nif not defined EW4_EDITOR_PORT set "EW4_EDITOR_PORT=5184"\r\nstart "" /b powershell.exe -NoProfile -WindowStyle Hidden -File "%~dp0Open-When-Ready.ps1" -Port %EW4_EDITOR_PORT%\r\n"%~dp0server\\Ew4.Editor.exe"\r\npause\r\n');
writeFileSync(join(desktop, 'Open-When-Ready.ps1'), 'param([int]$Port = 5184)\n$url = "http://127.0.0.1:$Port"\nfor ($i = 0; $i -lt 120; $i++) {\n  try { $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { Start-Process $url; exit } } catch {}\n  Start-Sleep -Milliseconds 250\n}\n');
writeFileSync(join(desktop, 'README.txt'), 'EW4 Mod Editor ' + version + '\r\nRun Start-Editor.cmd. Keep this folder writable. Original drafts use browser storage; R projects use editor-home/author.json. Export .ew4p or .ew4author before moving computers. No game saves are included.\r\n');
const tools = join(homedir(), '.codex/tools');
const androidDotnet = process.env.EW4_ANDROID_DOTNET || join(tools, 'dotnet-android/dotnet.exe');
run(androidDotnet, ['build', 'android/Ew4.Editor.Android.csproj', '-c', 'Release', '-p:RewriteSnapshot=' + join(home, 'rewrite'),
  '-p:AndroidSdkDirectory=' + (process.env.ANDROID_HOME || join(tools, 'android-sdk')),
  '-p:JavaSdkDirectory=' + (process.env.JAVA_HOME || join(tools, 'android-jdk')), '-v:q']);
const apk = join(release, 'ew4-mod-editor-' + version + '-arm64.apk');
cpSync(join(root, 'android/bin/Release/net10.0-android/android-arm64/org.ew4.modeditor-Signed.apk'), apk);
const zip = join(release, 'ew4-mod-editor-' + version + '-windows-web.zip');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const pendingZip = zip + '.pending';
run('powershell', ['-NoProfile', '-Command', "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem; $source=" + quote(desktop) + '; $archive=[IO.Compression.ZipFile]::Open(' + quote(pendingZip) + ',[IO.Compression.ZipArchiveMode]::Create); try { foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) { $name=$file.FullName.Substring($source.Length+1).Replace("\\", "/"); [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null } } finally { $archive.Dispose() }']);
renameSync(pendingZip, zip);
const hashes = [];
for (const path of [apk, zip]) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  hashes.push({ name: path.split(/[\\/]/).pop(), bytes, sha256: hash.digest('hex') });
}
writeFileSync(join(release, 'manifest.json'), JSON.stringify({ version, androidApplicationId: 'org.ew4.modeditor', androidDeviceTested: false, files: hashes }, null, 2));
writeFileSync(join(release, 'SHA256SUMS.txt'), hashes.map(f => f.sha256 + '  ' + f.name).join('\n') + '\n');
console.log(JSON.stringify({ release, files: hashes }));
