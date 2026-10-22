import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeShots, shotFlags } from '../src/golf/shot-data.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(root,'recordings/golf-shots');
const records=fs.existsSync(directory)?fs.readdirSync(directory).filter(n=>n.endsWith('.json')).flatMap(name=>{try{const record=JSON.parse(fs.readFileSync(path.join(directory,name)));return record.version===1&&record.id?[record]:[];}catch{return [];}}):[];
const source=process.argv.includes('--include-demo')?'all':'phone';
const summary=summarizeShots(records,{source});
console.log(JSON.stringify({generatedAt:new Date().toISOString(),scope:source==='phone'?'Recorded phone attempts only; mouse simulations excluded.':'Phone attempts and explicitly labelled mouse simulations.',...summary,flagged:records.filter(r=>source==='all'||r.source==='phone').map(r=>({id:r.id,player:r.playerName,club:r.launch?.club||r.attempt?.club,flags:shotFlags(r)})).filter(r=>r.flags.length)},null,2));
