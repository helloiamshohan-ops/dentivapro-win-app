import fs from 'node:fs';
const lock = JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const allow = new Set(['MIT','Apache-2.0','ISC','BSD-2-Clause','BSD-3-Clause','Python-2.0','CC-BY-4.0','BlueOak-1.0.0','0BSD','WTFPL','OFL-1.1','(MIT OR WTFPL)','(BSD-2-Clause OR MIT OR Apache-2.0)','WTFPL OR ISC','(MIT OR CC0-1.0)','(WTFPL OR MIT)']);
const packages=Object.entries(lock.packages).filter(([key])=>key.startsWith('node_modules/')).map(([key,value])=>({name:key.replace(/^node_modules\//,''),version:value.version,license:value.license||'UNKNOWN'}));
const unexpected=packages.filter(p=>!allow.has(p.license));
const lines=['# Third-party dependency inventory (development lockfile)','',`Generated from package-lock.json. ${packages.length} package entries. Licenses shown are npm metadata, not a complete legal review. This is not release sign-off.`,'','| Package | Version | License |','|---|---|---|',...packages.map(p=>`| ${p.name.replaceAll('|','\\|')} | ${p.version} | ${p.license.replaceAll('|','\\|')} |`)];
fs.writeFileSync('docs/THIRD_PARTY_NOTICES.md',lines.join('\n')+'\n');
if(unexpected.length){console.error('Unreviewed licenses:',unexpected);process.exitCode=1;}else console.log(`Inventory: ${packages.length} packages; no unexpected npm license identifiers. Manual notice review remains required.`);
