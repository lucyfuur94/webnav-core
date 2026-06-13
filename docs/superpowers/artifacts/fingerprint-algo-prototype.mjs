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
function scopeTexts(nodes,scope,candIdx){const out=[];for(let j=scope.idx+1;j<nodes.length;j++){if(nodes[j].depth<=scope.node.depth)break;if(j!==candIdx&&nodes[j].name&&nodes[j].name.trim())out.push(nodes[j].name);}return out;}

// THE MATCHER: given a near string, which candidates' clean scope contains it.
function matchByNear(nodes,cands,near){
  const set=new Set(cands.map(c=>c.i));const hits=[];
  for(const c of cands){const s=anchorScope(nodes,c.i,set);if(!s)continue;if(subtreeHas(nodes,s.idx,s.node.depth,(n,j)=>j!==c.i&&n.name===near))hits.push(c);}
  return hits;
}
export function resolve(nodes,role,name,near){
  const cands=nodes.map((n,i)=>({n,i})).filter(x=>x.n.role===role&&x.n.name===name&&x.n.ref);
  if(cands.length===1)return{status:'unique-role-name',ref:cands[0].n.ref};
  const hits=matchByNear(nodes,cands,near);
  if(hits.length===1)return{status:'RESOLVED',ref:hits[0].n.ref,ofCandidates:cands.length};
  return{status:hits.length===0?'escalate-0':'escalate-multi',candidates:cands.length,nearHits:hits.length};
}

// THE SELECTOR (B2/B3 keystone): WHICH text to store as `near` for a target candidate.
// Used at BOTH record-time and step-5 heal so they never diverge. Deterministic:
// enumerate text-bearing names in the target's clean scope (doc order), return the FIRST
// that — fed back through the matcher against the full candidate set — yields EXACTLY this
// candidate (i.e. a near that uniquely identifies it). null = honest "can't make unique"
// flag (a truly-identical sibling row). Note this naturally SKIPS a churny-but-non-unique
// first text (e.g. a repeated first-name) because it wouldn't resolve uniquely.
export function deriveNear(nodes,candIdx,role,name){
  const cands=nodes.map((n,i)=>({n,i})).filter(x=>x.n.role===role&&x.n.name===name&&x.n.ref);
  const me=cands.find(c=>c.i===candIdx); if(!me)return null;
  const set=new Set(cands.map(c=>c.i));
  const scope=anchorScope(nodes,candIdx,set); if(!scope)return null;
  for(const text of scopeTexts(nodes,scope,candIdx)){
    const hits=matchByNear(nodes,cands,text);
    if(hits.length===1&&hits[0].i===candIdx)return text;  // uniquely identifies ME
  }
  return null;  // no in-scope text makes this candidate unique -> honest flag, escalate
}
if(import.meta.url===`file://${process.argv[1]}`){
  const sd=parse(readFileSync(join(FIX,'saucedemo-inventory.yml'),'utf8'));
  const oh=parse(readFileSync(join(FIX,'orangehrm-pim-table.yml'),'utf8'));
  // discover the two glyph button names from the fixture (edit/delete), most frequent deep buttons
  const freq={};
  oh.filter(n=>n.role==='button'&&n.ref&&n.depth>=16).forEach(n=>{const k=n.name||'';freq[k]=(freq[k]||0)+1;});
  const glyphs=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,2).map(e=>e[0]);
  const EDIT=glyphs[0], DEL=glyphs[1];
  let ok=true;
  const check=(label,cond,detail)=>{ok=ok&&cond;console.log(`${cond?'PASS':'FAIL'} ${label}${detail?': '+detail:''}`);};
  const idxOfRef=(nodes,ref)=>nodes.findIndex(n=>n.ref===ref);

  // (A) MATCH proof: a known-good near resolves to the expected ref.
  for(const [label,r,want] of [
    ['SD Backpack', resolve(sd,'button','Add to cart','Sauce Labs Backpack'),'e54'],
    ['SD Bike Light', resolve(sd,'button','Add to cart','Sauce Labs Bike Light'),'e66'],
    ['SD Fleece', resolve(sd,'button','Add to cart','Sauce Labs Fleece Jacket'),'e90'],
    ['OH edit row 444444', resolve(oh,'button',EDIT,'444444'),'e288'],
    ['OH delete row 444444', resolve(oh,'button',DEL,'444444'),'e290'],
  ]) check('MATCH '+label, r.status==='RESOLVED'&&r.ref===want, JSON.stringify(r)+' want '+want);

  // (B) DERIVE round-trip (B2/B3 keystone): deriveNear(target) -> resolve(that) -> same ref.
  const roundtrip=(label,nodes,role,name,ref)=>{
    const ci=idxOfRef(nodes,ref);
    const near=deriveNear(nodes,ci,role,name);
    const back=near==null?null:resolve(nodes,role,name,near);
    check('DERIVE '+label, near!=null&&back&&back.status==='RESOLVED'&&back.ref===ref, 'near='+JSON.stringify(near)+' -> '+(back?back.ref:'null'));
  };
  roundtrip('SD e54',sd,'button','Add to cart','e54');
  roundtrip('SD e66',sd,'button','Add to cart','e66');
  roundtrip('SD e90',sd,'button','Add to cart','e90');
  roundtrip('OH edit e288',oh,'button',EDIT,'e288');   // must SKIP churny first-name, pick unique id
  roundtrip('OH delete e290',oh,'button',DEL,'e290');

  // (C) S3 honest-limit proof: content-identical rows must be unresolvable (deriveNear=null), not wrong-resolved.
  const editIdxs=oh.map((n,i)=>({n,i})).filter(x=>x.n.role==='button'&&x.n.name===EDIT&&x.n.ref).map(x=>x.i);
  const nullDerives=editIdxs.filter(ci=>deriveNear(oh,ci,'button',EDIT)===null);
  check('S3 identical-content rows escalate (deriveNear=null)', nullDerives.length>0, nullDerives.length+'/'+editIdxs.length+' edit buttons have no unique near');

  console.log(ok?'\nALL VERIFIED ✓':'\nFAILURES ✗');process.exit(ok?0:1);
}
