import { createHash } from 'node:crypto';

const json = (status, data) => new Response(JSON.stringify(data), {status, headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const logError = (stage, details={}) => console.error('CARE360_VISIT_V11_FAILURE', {stage,...details});
const isoDateSingapore = (now=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedPeriods = new Set(['morning','afternoon']);
export function validateSynthetic(body, today=isoDateSingapore()) {
  if (!body || typeof body!=='object' || Array.isArray(body)) return false;
  if (Object.keys(body).sort().join(',') !== 'client_request_id,preferred_date,preferred_period,turnstile_token') return false;
  if (typeof body.client_request_id!=='string' || !UUID.test(body.client_request_id)) return false;
  if (typeof body.preferred_date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.preferred_date)) return false;
  const date=new Date(body.preferred_date+'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==body.preferred_date) return false;
  const days=(Date.parse(body.preferred_date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;
  if (days<1 || days>90 || !allowedPeriods.has(body.preferred_period)) return false;
  if (typeof body.turnstile_token!=='string' || !body.turnstile_token || body.turnstile_token.length>4096) return false;
  return true;
}
export function fingerprint(body) {
  const canonical=JSON.stringify({client_request_id:body.client_request_id.toLowerCase(),preferred_date:body.preferred_date,preferred_period:body.preferred_period,notice_version:'SYNTHETIC-V0.3'});
  return createHash('sha256').update(canonical).digest('hex');
}
export default async function handler(request) {
  if (request.method!=='POST') return json(405,{error:'Method not allowed'});
  if (process.env.CARE360_VISIT_V11_ENABLED!=='true') return json(503,{error:'Synthetic intake disabled'});
  const allowed=process.env.CARE360_VISIT_V11_ALLOWED_ORIGIN;
  if (!allowed || request.headers.get('origin')!==allowed) return json(403,{error:'Origin not allowed'});
  if (!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json')) return json(415,{error:'JSON required'});
  const len=Number(request.headers.get('content-length')||0);
  if (len>4096) return json(413,{error:'Payload too large'});
  let body;
  try { const raw=await request.text(); if(raw.length>4096)return json(413,{error:'Payload too large'}); body=JSON.parse(raw); }
  catch { return json(400,{error:'Invalid JSON'}); }
  if(!validateSynthetic(body)) return json(400,{error:'Invalid synthetic request'});
  const secret=process.env.CARE360_VISIT_V11_TURNSTILE_SECRET;
  const url=process.env.CARE360_VISIT_V11_SUPABASE_URL;
  const key=process.env.CARE360_VISIT_V11_SUPABASE_SECRET;
  if(!secret||!key||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url||'')) return json(503,{error:'Server configuration incomplete'});
  let verification;
  try {
    const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',body:new URLSearchParams({secret,response:body.turnstile_token}),signal:AbortSignal.timeout(7000)});
    verification=await response.json();
  } catch(e) {logError('turnstile_network',{type:e?.name||'unknown'});return json(503,{error:'Verification unavailable'});}
  if (!verification?.success || verification.hostname!==new URL(allowed).hostname) return json(403,{error:'Verification failed'});
  const headers={'apikey':key,'content-type':'application/json'};
  if (!key.startsWith('sb_secret_')) headers.authorization=`Bearer ${key}`;
  const rpc={p_client_request_id:body.client_request_id.toLowerCase(),p_fingerprint:fingerprint(body),p_preferred_date:body.preferred_date,p_preferred_period:body.preferred_period};
  try {
    const response=await fetch(url+'/rest/v1/rpc/care360_create_synthetic_visit_with_consent',{
      method:'POST',headers,body:JSON.stringify(rpc),signal:AbortSignal.timeout(9000)});
    if (!response.ok) {
      let code='unknown';
      try {const data=await response.json();if(typeof data?.code==='string' && /^[A-Z0-9]{5,10}$/.test(data.code))code=data.code;}catch{}
      logError('supabase_http',{status:response.status,code});
      return json(code==='23505'?409:502,{error:code==='23505'?'Request ID conflict':'Database request failed'});
    }
    const result=await response.json();
    if (!result || typeof result.case_reference!=='string' || !/^C360-VISIT-DEMO-[A-F0-9]{12}$/.test(result.case_reference) || result.status!=='REQUESTED' || result.booking_confirmed!==false || result.synthetic!==true){
      logError('unexpected_response');return json(502,{error:'Unexpected database response'});
    }
    return json(202,{case_reference:result.case_reference,status:'REQUESTED',booking_confirmed:false,synthetic:true});
  } catch(e) {
    logError('supabase_network_or_timeout',{type:e?.name||'unknown',code:e?.cause?.code||null});
    return json(503,{error:'Submission outcome unknown; check database before retrying'});
  }
}
export const config={path:'/api/care360/visit-intake-synthetic'};
