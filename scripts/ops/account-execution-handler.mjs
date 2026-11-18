/** Insert-only account adapter. No credential discovery, login, registration events or balances.
 * Private source credentials exist only in the registered reader and the destination transaction. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Username,Profile} from '../../packages/contracts/src/http/identity.ts';
import {fingerprint,invariant,utc} from './legacy-delta-core.mjs';
import {assertMigrationOwnersAllowed} from './legacy-migration-owner-guards.mjs';
import {legacyMigrationOwnerDigest} from './legacy-migration-preservation.mjs';
import {assertExecutionTransaction,executionPolicyDigest,MigrationExecutionError} from './migration-execution-ledger.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const DOMAIN='legacy-accounts';
const bytesHash=value=>createHash('sha256').update(value).digest('hex');
const implementationDigest=bytesHash(readFileSync(new URL('./account-execution-handler.mjs',import.meta.url)));
const normalize=value=>value instanceof Date?value.toISOString():Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,normalize(v)])):value;
const defaultsFor=(row)=>({
  users:[{id:row.id,username:row.username,password_digest:bytesHash(row.passwordHash),current_alias:null,role:'user',status:'active',created_at:row.createdAt,updated_at:row.updatedAt,deletion_requested_at:null,banned_at:null}],
  aliases:[{alias:row.username.toLowerCase(),user_id:row.id,created_at:row.createdAt}],
  profiles:[{user_id:row.id,nickname:row.profile.nickname,avatar_media_id:null,moments_cover_media_id:null,birthday:row.profile.birthday,gender:row.profile.gender,city:row.profile.city,about:row.profile.about,nudge_suffix:null,time_zone:row.profile.timeZone,updated_at:row.updatedAt}],
  notifications:[{user_id:row.id,proactive_messages_enabled:false,proactive_calls_enabled:false,push_sound_enabled:true,push_show_content:true,dnd_enabled:false,dnd_start:'00:00',dnd_end:'08:00',allow_character_group_invites:true,updated_at:row.updatedAt}],
  preferences:[{user_id:row.id,theme:'green',guide_seen:[],updated_at:row.updatedAt}],
  deletionEvidence:[],
});

export function createAccountExecutionHandler({mode,sourceReader,options={},fault}) {
  invariant(['rehearsal','production'].includes(mode)&&sourceReader?.mode===mode&&HEX.test(sourceReader.digest)&&typeof sourceReader.read==='function','ACCOUNT_SOURCE_READER_REQUIRED');
  const policyDigest=executionPolicyDigest(options),digest=fingerprint({implementationDigest,reader:sourceReader.digest,policyDigest,mode});
  async function source(tx,sourceKey) {
    invariant(HEX.test(sourceKey),'ACCOUNT_SOURCE_KEY_REQUIRED');
    const data=await sourceReader.read({sourceKey,tx});
    invariant(data?.version===1&&HEX.test(data.snapshotDigest)&&HEX.test(data.reviewDigest)&&data.review?.kind==='new-since-initial-import'&&data.review.identityVerified===true&&data.review.sourceLifecycleReviewed===true,'ACCOUNT_SOURCE_REVIEW_REQUIRED');
    const raw=data.row;
    invariant(raw&&UUID.test(raw.id),'ACCOUNT_SOURCE_ID_INVALID');
    assertMigrationOwnersAllowed([raw.id],options);
    invariant(raw.role==='user'&&raw.status==='active'&&!raw.deletedAt&&!raw.bannedAt,'ACCOUNT_SOURCE_NOT_ACTIVE_USER');
    invariant(Username.safeParse(raw.username).success,'ACCOUNT_USERNAME_REQUIRES_REVIEW');
    invariant(typeof raw.passwordHash==='string'&&/^\$2[aby]\$(?:0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/.test(raw.passwordHash),'ACCOUNT_CREDENTIAL_FORMAT_UNSUPPORTED');
    const createdAt=utc(raw.createdAt),updatedAt=utc(raw.updatedAt??raw.createdAt),initialCutoff=utc(data.review.initialCutoff),cutoff=utc(data.review.cutoff);
    invariant(createdAt>initialCutoff&&createdAt<=cutoff&&updatedAt>=createdAt&&updatedAt<=cutoff,'ACCOUNT_SOURCE_WINDOW_INVALID');
    invariant(raw.profile&&Object.keys(raw.profile).every(k=>['nickname','birthday','gender','city','about','timeZone'].includes(k)),'ACCOUNT_PROFILE_MAPPING_REQUIRED');
    const checked=Profile.safeParse({...raw.profile,avatarMediaId:null,momentsCoverMediaId:null,nudgeSuffix:null,updatedAt});
    invariant(checked.success,'ACCOUNT_PROFILE_REQUIRES_REVIEW');
    try{new Intl.DateTimeFormat('en-US',{timeZone:raw.profile.timeZone}).format(new Date());}catch{throw new Error('ACCOUNT_TIMEZONE_INVALID');}
    const row={...raw,createdAt,updatedAt,profile:checked.data};
    const sourceFingerprint=fingerprint(data);
    return {row,data,sourceFingerprint,expected:defaultsFor(row),event:{key:fingerprint({domain:DOMAIN,sourceId:row.id}),digest:sourceFingerprint}};
  }
  async function target(tx,row) {
    const actual=(await tx.query('SELECT id,username,password_hash,current_alias,role,status,created_at,updated_at,deletion_requested_at,banned_at FROM identity.users WHERE id=$1 OR lower(username)=lower($2) OR lower(current_alias)=lower($2) ORDER BY id',[row.id,row.username])).rows;
    assertMigrationOwnersAllowed(actual.map(r=>r.id),options);
    const users=actual.map(({password_hash,...rest})=>({...rest,password_digest:bytesHash(password_hash)}));
    const aliases=(await tx.query('SELECT alias,user_id,created_at FROM identity.login_aliases WHERE lower(alias)=lower($1) OR user_id=$2 ORDER BY alias',[row.username,row.id])).rows;
    assertMigrationOwnersAllowed(aliases.map(r=>r.user_id),options);
    const profiles=(await tx.query('SELECT user_id,nickname,avatar_media_id,moments_cover_media_id,birthday,gender,city,about,nudge_suffix,time_zone,updated_at FROM identity.profiles WHERE user_id=$1',[row.id])).rows;
    const notifications=(await tx.query('SELECT user_id,proactive_messages_enabled,proactive_calls_enabled,push_sound_enabled,push_show_content,dnd_enabled,dnd_start,dnd_end,allow_character_group_invites,updated_at FROM identity.notification_settings WHERE user_id=$1',[row.id])).rows;
    const preferences=(await tx.query('SELECT user_id,theme,guide_seen,updated_at FROM identity.preferences WHERE user_id=$1',[row.id])).rows;
    const deletionEvidence=(await tx.query("SELECT id FROM platform.audit_log WHERE module='identity' AND action='user.deleted' AND target_type='user_hash' AND target_id=$1 ORDER BY id",[legacyMigrationOwnerDigest(row.id)])).rows;
    return normalize({users,aliases,profiles,notifications,preferences,deletionEvidence});
  }
  const scopeOf=src=>fingerprint({domain:DOMAIN,id:src.row.id,usernameDigest:bytesHash(src.row.username.toLowerCase()),sourceFingerprint:src.sourceFingerprint});
  const planOf=src=>fingerprint({scope:scopeOf(src),expected:src.expected,decision:'insert-new-account-only'});
  const safe=fn=>async(...args)=>{try{return await fn(...args);}catch(error){if(error instanceof MigrationExecutionError)throw error;throw new MigrationExecutionError(/^ACCOUNT_[A-Z_]+$/.test(error?.message??'')?error.message:'ACCOUNT_EXECUTION_FAILED');}};
  async function checked(tx,payload) {
    const src=await source(tx,payload.sourceKey);
    invariant(src.sourceFingerprint===payload.sourceFingerprint&&scopeOf(src)===payload.scopeDigest&&planOf(src)===payload.planDigest,'ACCOUNT_SOURCE_CHANGED');
    return {...src,baseline:await target(tx,src.row)};
  }
  async function observation(tx,payload) {
    const src=await checked(tx,payload);
    return {stateDigest:fingerprint(src.baseline),planDigest:payload.planDigest,scopeDigest:payload.scopeDigest,sourceDigest:src.data.snapshotDigest,events:[src.event],sourceOwnerIds:[src.row.id],targetOwnerIds:[...new Set([src.row.id,...src.baseline.users.map(r=>r.id),...src.baseline.aliases.map(r=>r.user_id)])]};
  }
  return Object.freeze({mode,domain:DOMAIN,digest,metrics:['inserted'],
    prepare:safe(async(tx,{sourceKey,dependsOn=[]})=>{
      const src=await source(tx,sourceKey),baseline=await target(tx,src.row);
      if(baseline.deletionEvidence.length||baseline.users.some(r=>r.id===src.row.id&&r.status==='deleting'))return {status:'preserve_deletion',unit:null,payload:null};
      if(baseline.users.some(r=>r.id===src.row.id))return {status:'preserve_existing_account',unit:null,payload:null};
      invariant(baseline.users.length===0&&baseline.aliases.length===0,'ACCOUNT_USERNAME_OR_ALIAS_CONFLICT');
      invariant(baseline.profiles.length===0&&baseline.notifications.length===0&&baseline.preferences.length===0,'ACCOUNT_ORPHAN_STATE_REQUIRES_REVIEW');
      const payload={version:1,sourceKey,sourceFingerprint:src.sourceFingerprint,planDigest:planOf(src),scopeDigest:scopeOf(src)};
      const unit={key:fingerprint({domain:DOMAIN,id:src.row.id}),domain:DOMAIN,handlerDigest:digest,planDigest:payload.planDigest,scopeDigest:payload.scopeDigest,beforeDigest:fingerprint(baseline),afterDigest:fingerprint(src.expected),sourceOwnerDigests:[legacyMigrationOwnerDigest(src.row.id)],targetOwnerDigests:[legacyMigrationOwnerDigest(src.row.id)],events:[src.event],dependsOn};
      return {status:'planned',unit,payload,sourceDigest:src.data.snapshotDigest};
    }),
    inspect:safe(observation),inspectAfter:safe(observation),
    apply:safe(async(tx,payload)=>{
      assertExecutionTransaction(tx,{mode,domain:DOMAIN,handlerDigest:digest,policyDigest,planDigest:payload.planDigest,scopeDigest:payload.scopeDigest});
      await tx.query('LOCK TABLE identity.users,identity.login_aliases IN SHARE ROW EXCLUSIVE MODE');
      const src=await checked(tx,payload),{row,baseline}=src;
      assertExecutionTransaction(tx,{sourceDigest:src.data.snapshotDigest});
      invariant(Object.values(baseline).every(v=>Array.isArray(v)&&v.length===0),'ACCOUNT_TARGET_CHANGED');
      await tx.query("INSERT INTO identity.users(id,username,password_hash,role,status,created_at,updated_at) VALUES($1,$2,$3,'user','active',$4,$5)",[row.id,row.username,row.passwordHash,row.createdAt,row.updatedAt]);
      await fault?.('after_account');
      await tx.query('INSERT INTO identity.login_aliases(alias,user_id,created_at) VALUES(lower($1),$2,$3)',[row.username,row.id,row.createdAt]);
      await tx.query('INSERT INTO identity.profiles(user_id,nickname,birthday,gender,city,about,time_zone,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[row.id,row.profile.nickname,row.profile.birthday,row.profile.gender,row.profile.city,row.profile.about,row.profile.timeZone,row.updatedAt]);
      await tx.query("INSERT INTO identity.notification_settings(user_id,proactive_messages_enabled,proactive_calls_enabled,push_sound_enabled,push_show_content,dnd_enabled,dnd_start,dnd_end,allow_character_group_invites,updated_at) VALUES($1,false,false,true,true,false,'00:00','08:00',true,$2)",[row.id,row.updatedAt]);
      await tx.query("INSERT INTO identity.preferences(user_id,theme,guide_seen,updated_at) VALUES($1,'green','[]'::jsonb,$2)",[row.id,row.updatedAt]);
      await fault?.('before_account_commit');
      return {inserted:1};
    }),
  });
}
