// Validates extraction proposals only. Never authorizes confirmed state.
export function validateProposal(x) {
 if(!x || !Array.isArray(x.bags) || x.safety_verified !== false) throw Error('Invalid envelope');
 const ids=new Set();
 const evidence=v=>{const a=typeof v==='string'?[v]:v??[]; if(!Array.isArray(a)||a.some(s=>typeof s!=='string'||!s.trim()))throw Error('Invalid evidence');return a;};
 return {safety_verified:false,bags:x.bags.map(b=>{
 if(!['A','B','C'].includes(b.id)||ids.has(b.id))throw Error('Invalid/duplicate bag'); ids.add(b.id);
 if(!Array.isArray(b.reported_quantities))throw Error('Missing reports');
 const reports=b.reported_quantities.map(r=>{if(!Number.isSafeInteger(r.value)||r.value<0)throw Error('Invalid quantity');const e=evidence(r.evidence);if(!e.length)throw Error('Unsourced quantity');return {value:r.value,evidence:e};});
 if(b.step!==null&&(!Number.isSafeInteger(b.step)||b.step<1||b.step>5))throw Error('Invalid step');
 return {id:b.id,reports,step:b.step,evidence:evidence(b.evidence),confirmed_quantity:null,model_confirmation_proposal:b.confirmed_quantity??null,requires_user_event:true};})};
}
