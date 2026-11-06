import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const source = resolve(process.argv[2] || '../o4mod/rewrite/mod-kit/docs/porting');
const result = Object.fromEntries(readdirSync(source).filter(p => p.endsWith('.md')).map(p => [p, readFileSync(resolve(source, p), 'utf8')]));
writeFileSync('public/rule-guides.json', JSON.stringify(result));
console.log(`Frozen ${Object.keys(result).length} offline rule guides.`);
const examples = resolve(source, '../../examples');
const labels = { 'unit-layers': '空地分层', 'advanced-units': '双层协同单位与机场', 'commander-abilities': '自定义将领能力', 'passive-auras': '被动光环', 'scenario-economy': '剧本粮食与收入', 'scenario-armies': '事件增援与将领任免', 'item-effects': '装备与物品效果', 'legacy-skill-parameters': '原技能参数' };
const packs = [];
for (const [id, name] of Object.entries(labels)) {
  const directory = resolve(examples, id), files = {};
  function scan(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) scan(path);
      else {
        const key = relative(directory, path).replaceAll('\\', '/');
        if (/^(rewrite|client|legacy)\/.+\.(json|lua|png)$/.test(key)) files[key] = readFileSync(path).toString('base64');
      }
    }
  }
  scan(directory); packs.push({ id, name, files });
}
writeFileSync('public/rule-examples.json', JSON.stringify(packs));
console.log(`Frozen ${packs.length} current-engine rule examples.`);
