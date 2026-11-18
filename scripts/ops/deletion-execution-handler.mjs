/** Exact legacy user-deletion adapter. No transport, connections, service controls or production CLI. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fingerprint, invariant, utc } from './legacy-delta-core.mjs';
import { legacyId, legacyMessageContents } from './legacy-content-rules.mjs';
import { assertMigrationOwnersAllowed } from './legacy-migration-owner-guards.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
import { assertExecutionTransaction, executionPolicyDigest, MigrationExecutionError } from './migration-execution-ledger.mjs';

const DOMAIN = 'chat-deletions', HEX = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const INITIAL = '2026-10-24T12:02:47.053609Z', MAX_CANDIDATES = 2_000_000;
const unique = (values) => [...new Set(values)].sort();
const normalize = (value) => value instanceof Date ? value.toISOString() : Buffer.isBuffer(value)
  ? { sha256:createHash('sha256').update(value).digest('hex') }
  : Array.isArray(value) ? value.map(normalize)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalize(item)])) : value;
const conversationFields = ['id','owner_user_id','type','character_id','official_identity_key','system_participant_id','content_scope','last_seq','archived_at','created_at','updated_at'];
const messageFields = ['id','conversation_id','seq','sender_participant_id','sender_kind','client_msg_id','content_ciphertext','quote_message_id','status','scope','labels','content_type','action_id','action_chosen_at','created_at','recalled_at','charged_micros','usage_record_id'];
const pick = (row, fields) => Object.fromEntries(fields.map((key)=>[key,row[key]??null]));
export const deletionTargetMessageDigest = (row) => fingerprint(normalize(pick(row,messageFields)));
export const deletionConversationDigest = (row) => fingerprint(normalize(pick(row,conversationFields)));
const implementation = Object.fromEntries(['./deletion-execution-handler.mjs','./legacy-content-rules.mjs'].map((name)=>[name,createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex')]));

/** Reader code must authenticate provenance and fragment proofs. This module supplies no production reader. */
export function createDeletionExecutionHandler({mode='plan',sourceReader,options={},fault}={}) {
  invariant(['plan','rehearsal','production'].includes(mode),'DELETION_MODE_INVALID');
  invariant(sourceReader?.mode===mode && HEX.test(sourceReader?.digest) && HEX.test(sourceReader?.codeDigest) &&
    typeof sourceReader.read==='function' && typeof sourceReader.readProof==='function','DELETION_SOURCE_READER_REQUIRED');
  invariant(!fault || mode==='rehearsal','DELETION_PRODUCTION_FAULT_HOOK_REFUSED');
  const policyDigest=executionPolicyDigest(options);
  const digest=fingerprint({domain:DOMAIN,version:1,mode,implementation,reader:sourceReader.digest,sourceCode:sourceReader.codeDigest,policyDigest});

  async function proof(tx,proofDigest) {
    invariant(HEX.test(proofDigest),'DELETION_PROOF_DIGEST_REQUIRED');
    const value=await sourceReader.readProof({proofDigest,tx});
    invariant(value && typeof value==='object' && !Array.isArray(value) && fingerprint(value)===proofDigest,'DELETION_PROOF_READBACK_FAILED');
    invariant(HEX.test(value.authorityDigest) && HEX.test(value.evidenceDigest),'DELETION_PROOF_AUTHORITY_REQUIRED');
    return value;
  }

  async function source(tx,sourceKey) {
    invariant(HEX.test(sourceKey),'DELETION_SOURCE_KEY_REQUIRED');
    const data=await sourceReader.read({sourceKey,tx});
    invariant(data && HEX.test(data.snapshotDigest) && utc(data.initialCutoff)===utc(INITIAL) &&
      utc(data.cutoff)>utc(INITIAL) && Array.isArray(data.sources) && data.sources.length>0 && data.sources.length<=2000,'DELETION_SOURCE_INVALID');
    const entries=[],seen=new Set(),ownerIds=[];
    for(const item of data.sources) {
      const row=item?.row,table=item?.table;
      invariant(row && ['chat_history','group_messages'].includes(table) && typeof row.id==='string' && row.id.length>0 && row.id.length<=200 &&
        (table!=='chat_history' || /^\d+$/u.test(row.id)) && UUID.test(item.conversationId),'DELETION_SOURCE_ID_INVALID');
      invariant(row.user_id==null || typeof row.user_id==='string','DELETION_SOURCE_OWNER_INVALID');
      const owner=table==='chat_history' ? row.user_id : item.group?.user_id;
      invariant(UUID.test(owner),'DELETION_SOURCE_OWNER_REQUIRED');
      if(table==='group_messages') invariant(item.group?.id===row.group_id && (!row.user_id || row.user_id===owner),'DELETION_GROUP_OWNER_CONFLICT');
      assertMigrationOwnersAllowed([owner],options);ownerIds.push(owner);
      const key=`${table}:${row.id}`;invariant(!seen.has(key),'DELETION_SOURCE_DUPLICATE');seen.add(key);
      invariant(['message','conversation'].includes(row.deletion_scope) && typeof row.deleted_at==='string' &&
        utc(row.created_at)<=utc(INITIAL) && utc(row.deleted_at)>utc(INITIAL) && utc(row.deleted_at)<=utc(data.cutoff),'DELETION_SOURCE_WINDOW_OR_SCOPE_INVALID');
      invariant(['content','quoted_content','quoted_author'].every(field=>row[field]==null||typeof row[field]==='string'),'DELETION_SOURCE_CONTENT_SHAPE_INVALID');
      const rowDigest=fingerprint(row), provenance=await proof(tx,item.provenanceProofDigest);
      const expected={version:1,kind:'legacy-user-deletion',sourceDigest:data.snapshotDigest,table,sourceId:row.id,ownerUserId:owner,sourceRowDigest:rowDigest,
        actorKind:'user',actorUserId:owner,operation:row.deletion_scope==='message'?'user-message-delete':'user-conversation-clear',
        deletedAt:utc(row.deleted_at),initialCutoff:utc(data.initialCutoff),cutoff:utc(data.cutoff),
        decision:'hide-exact-fragments-preserve-memory',sourceCodeDigest:sourceReader.codeDigest,
        memoryPolicy:'preserve',memoryReviewDigest:provenance.memoryReviewDigest,
        authorityDigest:provenance.authorityDigest,evidenceDigest:provenance.evidenceDigest};
      invariant(HEX.test(provenance.memoryReviewDigest) && fingerprint(provenance)===fingerprint(expected),'DELETION_USER_PROVENANCE_REQUIRED');
      const fragments=await proof(tx,item.fragmentProofDigest);
      invariant(fragments.version===1 && fragments.kind==='legacy-deletion-fragments' && fragments.sourceDigest===data.snapshotDigest &&
        fragments.table===table && fragments.sourceId===row.id && fragments.ownerUserId===owner && fragments.sourceRowDigest===rowDigest &&
        fragments.conversationId===item.conversationId && HEX.test(fragments.conversationDigest) && HEX.test(fragments.importCodeDigest) &&
        ['text-complete','media-bounded','missing-first'].includes(fragments.resolution) && Array.isArray(fragments.fragments) &&
        fragments.fragments.length<=100_000 && Array.isArray(fragments.absentParts),'DELETION_FRAGMENT_PROOF_INVALID');
      invariant(fragments.quotePolicy==='block-any' && fragments.memoryPolicy==='preserve','DELETION_IMPACT_POLICY_REQUIRED');
      entries.push({item,row,table,owner,rowDigest,provenance,fragments});
    }
    invariant(unique(ownerIds).length===1,'DELETION_SINGLE_OWNER_REQUIRED');
    return {data,entries,ownerId:ownerIds[0],reviewDigest:fingerprint(data)};
  }

  async function target(tx,src) {
    const ownerId=src.ownerId,conversationIds=unique(src.entries.map(entry=>entry.item.conversationId));
    for(const key of [`migration:${ownerId}`,`ai_runtime:user:${ownerId}`]) await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
    for(const id of conversationIds) await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:conversation:' || $1,0))",[id]);
    const conversations=(await tx.query(`SELECT ${conversationFields.join(',')} FROM chat.conversations WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,[conversationIds])).rows;
    assertMigrationOwnersAllowed(conversations.map(row=>row.owner_user_id),options);
    invariant(conversations.length===conversationIds.length && conversations.every(row=>row.owner_user_id===ownerId),'DELETION_TARGET_OWNER_CONFLICT');
    const user=(await tx.query('SELECT id,status FROM identity.users WHERE id=$1',[ownerId])).rows[0];
    invariant(user?.status==='active','DELETION_TARGET_ACCOUNT_NOT_ACTIVE');
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('realtime:' || $1,0))",[ownerId]);
    const states=(await tx.query('SELECT * FROM chat.user_conversation_states WHERE conversation_id=ANY($1::uuid[]) ORDER BY conversation_id,user_id FOR UPDATE',[conversationIds])).rows;
    assertMigrationOwnersAllowed(states.map(row=>row.user_id),options);
    invariant(states.every(row=>row.user_id===ownerId),'DELETION_TARGET_STATE_OWNER_CONFLICT');
    const convById=new Map(conversations.map(row=>[row.id,row])), firstIds=src.entries.map(entry=>legacyId('message',entry.table,entry.row.id,0));
    const first=(await tx.query('SELECT id,conversation_id FROM chat.messages WHERE id=ANY($1::uuid[])',[firstIds])).rows;
    const firstById=new Map(first.map(row=>[row.id,row])), candidates=[],missingFirst=[];
    let candidateCount=0;
    for(const entry of src.entries) {
      const {row,table,fragments}=entry,conv=convById.get(entry.item.conversationId),firstId=legacyId('message',table,row.id,0);
      invariant(deletionConversationDigest(conv)===fragments.conversationDigest,'DELETION_CONVERSATION_CHANGED');
      const existing=firstById.get(firstId);
      if(!existing) {
        invariant(fragments.resolution==='missing-first' && fragments.fragments.length===0 && fragments.absentParts.length===1 && fragments.absentParts[0]===0 && fragments.bound===null,'DELETION_MISSING_FIRST_REQUIRES_EXPLICIT_SKIP');
        missingFirst.push(firstId);continue;
      }
      invariant(existing.conversation_id===conv.id,'DELETION_TARGET_ID_SCOPE_CONFLICT');
      const media=['image','voice','sticker'].includes(row.message_type);
      const bound=media?Number(conv.last_seq):legacyMessageContents(row,null).length;
      invariant(Number.isSafeInteger(bound)&&bound>0&&bound<=MAX_CANDIDATES &&
        fragments.resolution===(media?'media-bounded':'text-complete') && fragments.bound===bound,'DELETION_FRAGMENT_BOUND_INVALID');
      candidateCount+=bound;invariant(candidateCount<=MAX_CANDIDATES,'DELETION_FRAGMENT_SCAN_BUDGET_EXCEEDED');
      for(let part=0;part<bound;part++) candidates.push({entry,part,id:legacyId('message',table,row.id,part),clientId:legacyId('client-message',table,row.id,part)});
    }
    const rows=[];
    for(let start=0;start<candidates.length;start+=2000) rows.push(...(await tx.query(`SELECT m.*,c.owner_user_id AS actual_owner FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id WHERE m.id=ANY($1::uuid[]) ORDER BY m.id FOR UPDATE OF m`,[candidates.slice(start,start+2000).map(item=>item.id)])).rows);
    assertMigrationOwnersAllowed(rows.map(row=>row.actual_owner),options);
    invariant(rows.every(row=>row.actual_owner===ownerId),'DELETION_TARGET_OWNER_CONFLICT');
    const byId=new Map(rows.map(row=>[row.id,row])), resolved=new Map(src.entries.map(entry=>[entry,{fragments:[],absentParts:[]}]));
    for(const candidate of candidates) {
      const {entry,part,id,clientId}=candidate,row=byId.get(id),scope=resolved.get(entry);
      if(!row){scope.absentParts.push(part);continue;}
      invariant(row.conversation_id===entry.item.conversationId && row.client_msg_id===clientId && utc(row.created_at)===utc(entry.row.created_at) &&
        ['normal','recalled'].includes(row.status) && Number.isSafeInteger(Number(row.seq)) && Number(row.seq)>0,'DELETION_TARGET_FRAGMENT_IDENTITY_CONFLICT');
      scope.fragments.push({part,messageId:id,clientId,seq:Number(row.seq),status:row.status,rowDigest:deletionTargetMessageDigest(row)});
    }
    for(const entry of src.entries) {
      if(missingFirst.includes(legacyId('message',entry.table,entry.row.id,0)))continue;
      const actual=resolved.get(entry);
      invariant(fingerprint(actual.fragments)===fingerprint(entry.fragments.fragments) && fingerprint(actual.absentParts)===fingerprint(entry.fragments.absentParts),'DELETION_FRAGMENT_PROOF_CHANGED');
    }
    const ids=unique(rows.map(row=>row.id));
    const quotes=ids.length?(await tx.query('SELECT id FROM chat.messages WHERE quote_message_id=ANY($1::uuid[]) LIMIT 1',[ids])).rows:[];
    invariant(quotes.length===0,'DELETION_QUOTE_REVIEW_REQUIRED');
    const hidden=ids.length?(await tx.query('SELECT message_id,user_id FROM chat.hidden_messages WHERE message_id=ANY($1::uuid[]) ORDER BY message_id,user_id',[ids])).rows:[];
    assertMigrationOwnersAllowed(hidden.map(row=>row.user_id),options);
    invariant(hidden.every(row=>row.user_id===ownerId),'DELETION_HIDDEN_OWNER_CONFLICT');
    const hiddenIds=new Set(hidden.map(row=>row.message_id));
    const state={ownerId,conversations:normalize(conversations),states:normalize(states),
      targets:rows.sort((a,b)=>a.id.localeCompare(b.id)).map(row=>({id:row.id,rowDigest:deletionTargetMessageDigest(row),hidden:hiddenIds.has(row.id)})),missingFirst:missingFirst.sort()};
    return {state,ids,toHide:ids.filter(id=>!hiddenIds.has(id)),candidateCount,targetOwnerIds:unique([user.id,...conversations.map(row=>row.owner_user_id)])};
  }

  const events = (src) => src.entries.map(entry=>({key:fingerprint({domain:DOMAIN,table:entry.table,sourceId:entry.row.id}),
    digest:fingerprint({sourceRowDigest:entry.rowDigest,provenanceProofDigest:entry.item.provenanceProofDigest,fragmentProofDigest:entry.item.fragmentProofDigest})})).sort((a,b)=>a.key.localeCompare(b.key));
  const scopeOf = (payload) => fingerprint({sourceKey:payload.sourceKey,reviewDigest:payload.reviewDigest,ownerId:payload.ownerId,ids:payload.ids,missingFirst:payload.before.missingFirst});
  const planDigest = (payload) => fingerprint(payload);
  async function checked(tx,payload) {
    invariant(payload?.version===1 && UUID.test(payload.ownerId) && HEX.test(payload.reviewDigest) && Array.isArray(payload.ids),'DELETION_PAYLOAD_INVALID');
    const src=await source(tx,payload.sourceKey);invariant(src.ownerId===payload.ownerId&&src.reviewDigest===payload.reviewDigest,'DELETION_SOURCE_REVIEW_CHANGED');
    const current=await target(tx,src);
    invariant(fingerprint(current.ids)===fingerprint(payload.ids),'DELETION_EXACT_TARGET_SET_CHANGED');
    return {...src,...current};
  }
  async function observation(tx,payload,requireAfter=false) {
    const current=await checked(tx,payload),state=current.state;
    const allHidden=state.targets.every(row=>row.hidden);
    if(requireAfter) invariant(allHidden,'DELETION_POSTCONDITION_NOT_HIDDEN');
    const after=allHidden && payload.cursorFloor!==null;
    if(after) {
      const cursor=(await tx.query('SELECT last_update_seq,trimmed_through FROM realtime.user_update_cursors WHERE user_id=$1',[payload.ownerId])).rows[0];
      invariant(cursor && cursor.last_update_seq===cursor.trimmed_through && BigInt(cursor.last_update_seq)>=BigInt(payload.cursorFloor),'DELETION_SYNC_INVALIDATION_MISSING');
    }
    return {stateDigest:fingerprint({state,cursorFloor:after?payload.cursorFloor:null}),planDigest:planDigest(payload),scopeDigest:scopeOf(payload),
      sourceDigest:current.data.snapshotDigest,events:events(current),sourceOwnerIds:[current.ownerId],targetOwnerIds:current.targetOwnerIds};
  }
  const safe=(fn)=>async(...args)=>{try{return await fn(...args);}catch(error){
    if(error instanceof MigrationExecutionError)throw error;
    const code=typeof error?.message==='string'&&/^(?:DELETION_[A-Z0-9_]+|LEGACY_MIGRATION_OWNER_PRESERVED)$/u.test(error.message)?error.message:'DELETION_ADAPTER_FAILED';
    throw new MigrationExecutionError(code);
  }};
  return Object.freeze({mode,domain:DOMAIN,digest,metrics:['hiddenInserted','alreadyHidden','missingFirstSources','cursorInvalidations'],
    prepare:safe(async(tx,{sourceKey,dependsOn=[]})=>{
      const src=await source(tx,sourceKey),current=await target(tx,src);
      const cursor=(await tx.query('SELECT last_update_seq FROM realtime.user_update_cursors WHERE user_id=$1',[src.ownerId])).rows[0];
      const cursorFloor=current.toHide.length?Number(cursor?.last_update_seq??0)+1:null;
      invariant(cursorFloor===null||Number.isSafeInteger(cursorFloor),'DELETION_CURSOR_RANGE_INVALID');
      const payload={version:1,sourceKey,reviewDigest:src.reviewDigest,ownerId:src.ownerId,ids:current.ids,before:current.state,cursorFloor};
      const after={...current.state,targets:current.state.targets.map(row=>({...row,hidden:true}))};
      const unit={key:fingerprint({domain:DOMAIN,ownerId:src.ownerId,reviewDigest:src.reviewDigest}),domain:DOMAIN,handlerDigest:digest,planDigest:planDigest(payload),scopeDigest:scopeOf(payload),
        beforeDigest:fingerprint({state:current.state,cursorFloor:null}),afterDigest:fingerprint({state:after,cursorFloor}),
        sourceOwnerDigests:[legacyMigrationOwnerDigest(src.ownerId)],targetOwnerDigests:current.targetOwnerIds.map(legacyMigrationOwnerDigest).sort(),events:events(src),dependsOn};
      return {status:'planned',unit,payload,sourceDigest:src.data.snapshotDigest};
    }),
    inspect:safe((tx,payload)=>observation(tx,payload)),inspectAfter:safe((tx,payload)=>observation(tx,payload,true)),
    apply:safe(async(tx,payload)=>{
      const scope={mode,domain:DOMAIN,handlerDigest:digest,policyDigest,planDigest:planDigest(payload),scopeDigest:scopeOf(payload)};
      assertExecutionTransaction(tx,scope);
      const current=await checked(tx,payload);assertExecutionTransaction(tx,{...scope,sourceDigest:current.data.snapshotDigest});
      invariant(fingerprint(current.state)===fingerprint(payload.before),'DELETION_TARGET_CHANGED_BEFORE_APPLY');
      let inserted=0;
      if(current.toHide.length){
        const result=await tx.query('INSERT INTO chat.hidden_messages(message_id,user_id) SELECT x,$2::uuid FROM unnest($1::uuid[]) AS x ON CONFLICT DO NOTHING',[current.toHide,payload.ownerId]);
        inserted=result.rowCount;invariant(inserted===current.toHide.length,'DELETION_HIDDEN_SET_RACED');
        await fault?.('after_hidden_insert');
        await tx.query(`INSERT INTO realtime.user_update_cursors(user_id,last_update_seq,trimmed_through) VALUES($1,1,1)
          ON CONFLICT(user_id) DO UPDATE SET last_update_seq=realtime.user_update_cursors.last_update_seq+1,trimmed_through=realtime.user_update_cursors.last_update_seq+1`,[payload.ownerId]);
      }
      await fault?.('before_ledger_receipt');
      return {hiddenInserted:inserted,alreadyHidden:current.ids.length-inserted,missingFirstSources:current.state.missingFirst.length,cursorInvalidations:inserted?1:0};
    }),
  });
}
