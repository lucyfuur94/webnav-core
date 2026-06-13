// PROTOTYPE + PROOF for the element-fingerprint `near` resolution algorithm.
// Run: node docs/superpowers/artifacts/fingerprint-algo-prototype.mjs
// Verifies the spec's resolveByNear/anchorRef rule against the REAL committed captures.
// The production impl lives in src/router/resolve.ts (Phase 2); this is the design proof.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures');

function parse(yml){const nodes=[];for(const line of yml.split('\n')){if(!line.trim())continue;const depth=line.length-line.replace(/^ */,'').length;const t=line.trim().replace(/^-\s*/,'');if(t.startsWith('/url:'))continue;const m=t.match(/^(\w[\w-]*)\s*(?:"([^"]*)")?/);if(!m)continue;const hasName=m[2]!==undefined;const hasAttr=/\[[^\]]+\]/.test(t);if(!hasName&&!hasAttr)continue;const ref=(t.match(/\[ref=(e\d+)\]/)||[])[1]||null;nodes.push({depth,role:m[1],name:m[2]??null,ref});}return nodes;}
function ancestorsOf(nodes,idx){const out=[];let minD=nodes[idx].depth;for(let i=idx-1;i>=0;i--){if(nodes[i].depth<minD){out.push({node:nodes[i],idx:i});minD=nodes[i].depth;}}return out;}
function subtreeHas(nodes,aIdx,aDepth,pred){for(let j=aIdx+1;j<nodes.length;j++){if(nodes[j].depth<=aDepth)break;if(pred(nodes[j],j))return true;}return false;}
// LARGEST enclosing scope that excludes every other candidate
function anchorScope(nodes,candIdx,set){let scope=null;for(const a of ancestorsOf(nodes,candIdx)){if(subtreeHas(nodes,a.idx,a.node.depth,(n,j)=>j!==candIdx&&set.has(j)))break;scope=a;}return scope;}
export function resolve(nodes,role,name,near){
  const cands=nodes.map((n,i)=>({n,i})).filter(x=>x.n.role===role&&x.n.name===name&&x.n.ref);
  if(cands.length===1)return{status:'unique-role-name',ref:cands[0].n.ref};
  const set=new Set(cands.map(c=>c.i));const hits=[];
  for(const c of cands){const s=anchorScope(nodes,c.i,set);if(!s)continue;if(subtreeHas(nodes,s.idx,s.node.depth,(n,j)=>j!==c.i&&n.name===near))hits.push(c);}
  if(hits.length===1)return{status:'RESOLVED',ref:hits[0].n.ref,ofCandidates:cands.length};
  return{status:hits.length===0?'escalate-0':'escalate-multi',candidates:cands.length,nearHits:hits.length};
}
if(import.meta.url===`file://${process.argv[1]}`){
  const sd=parse(readFileSync(join(FIX,'saucedemo-inventory.yml'),'utf8'));
  const EDIT='', DEL='';
  const oh=parse(readFileSync(join(FIX,'orangehrm-pim-table.yml'),'utf8'));
  const cases=[
    ['SD Backpack', resolve(sd,'button','Add to cart','Sauce Labs Backpack'),'e54'],
    ['SD Bike Light', resolve(sd,'button','Add to cart','Sauce Labs Bike Light'),'e66'],
    ['SD Fleece', resolve(sd,'button','Add to cart','Sauce Labs Fleece Jacket'),'e90'],
    ['OH edit row 444444', resolve(oh,'button',EDIT,'444444'),'e288'],
    ['OH delete row 444444', resolve(oh,'button',DEL,'444444'),'e290'],
  ];
  let ok=true;
  for(const [label,r,want] of cases){const pass=r.status==='RESOLVED'&&r.ref===want;ok&&=pass;console.log(`${pass?'PASS':'FAIL'} ${label}: ${JSON.stringify(r)} (want ${want})`);}
  console.log(ok?'\nALL VERIFIED ✓':'\nFAILURES ✗');process.exit(ok?0:1);
}
