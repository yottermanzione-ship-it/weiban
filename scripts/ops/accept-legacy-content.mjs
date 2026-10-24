#!/usr/bin/env node
/** One controlled public-API read check. Ephemeral session tokens never leave server memory. */
import 'reflect-metadata';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import { SystemClock } from '../../apps/server/src/platform/clock/clock.ts';
import { AuditLog } from '../../apps/server/src/platform/audit/audit-log.ts';
import { generateSessionToken, hashToken } from '../../apps/server/src/modules/identity/domain/rules.ts';
import { ChatEndpoints } from '../../packages/contracts/src/http/chat.ts';
import { ContactsEndpoints } from '../../packages/contracts/src/http/contacts.ts';
import { MomentsEndpoints } from '../../packages/contracts/src/http/moments.ts';
import { MediaEndpoints } from '../../packages/contracts/src/http/media.ts';
import { MemoryEndpoints } from '../../packages/contracts/src/http/memory.ts';
const config=loadConfig(),clock=new SystemClock(),db=new Database({url:config.database.url,poolMax:2}),audit=new AuditLog(db,clock);
const OWNER='9a76a467-fe83-41c1-9e3c-6270aefb8447',OP='01a12a78-aeb5-711a-a7ce-b373c65b8e53',BASE='http://103.231.58.124',REPORT='/reports/content-public-acceptance.json';
const isolationOnly=process.argv.includes('--isolation-only');
const sessionId=randomUUID(),token=generateSessionToken(),checks=[];let created=false;
async function jsonCheck(label,url,schema,expected=200){const response=await fetch(BASE+url,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});let body;try{body=await response.json();}catch{body=null;}const allowed=(Array.isArray(expected)?expected:[expected]).includes(response.status);const parsed=allowed&&schema?schema.safeParse(body):null;const ok=allowed&&(!schema||parsed?.success);checks.push({label,status:response.status,ok,schemaErrors:parsed&&!parsed.success?parsed.error.issues.map(i=>({path:i.path.join('.'),code:i.code})):undefined,items:body?.items?.length});if(!ok)throw new Error('PUBLIC_API_ACCEPTANCE_FAILED');return body;}
async function mediaCheck(label,id){const meta=await jsonCheck(label+' info',`/api/v1/media/${id}`,MediaEndpoints.getMedia.response);const response=await fetch(meta.url,{redirect:'error',signal:AbortSignal.timeout(30000)});const bytes=Buffer.from(await response.arrayBuffer());const ok=response.status===200&&bytes.length===meta.sizeBytes;checks.push({label:label+' bytes',status:response.status,ok,bytes:bytes.length,mime:meta.mimeType,header:bytes.subarray(0,4).toString('hex')});if(!ok)throw new Error('MEDIA_PUBLIC_DOWNLOAD_FAILED');}
async function main(){
 if(!(await db.query("SELECT 1 FROM identity.users WHERE id=$1 AND status='active'",[OWNER])).rows.length)throw new Error('OWNER_ACCOUNT_REQUIRED');
 const now=new Date(),expires=new Date(now.getTime()+5*60000);
 await db.query("INSERT INTO identity.sessions(id,user_id,kind,token_hash,device,created_at,last_active_at,expires_at) VALUES($1,$2,'app',$3,$4::jsonb,$5,$5,$6)",[sessionId,OWNER,hashToken(token),JSON.stringify({platform:'web',name:'Temporary migration verification',appVersion:'migration-v1',timeZone:'Asia/Shanghai'}),now,expires]);created=true;
 await audit.record({module:'identity',action:'legacy_migration.temporary_read_session',actorType:'admin',actorId:OP,targetType:'user',targetId:OWNER,details:{sessionId,expiresAt:expires.toISOString()}});
 if(!isolationOnly){
 await jsonCheck('contacts','/api/v1/contacts',ContactsEndpoints.list.response);
 await jsonCheck('conversations','/api/v1/conversations',ChatEndpoints.listConversations.response);
 const convos=(await db.query('SELECT id,type FROM chat.conversations WHERE owner_user_id=$1 AND last_seq>0 ORDER BY last_seq DESC',[OWNER])).rows;
 const direct=convos.find(c=>c.type==='direct'),group=convos.find(c=>c.type==='group');
 for(const c of [direct,group].filter(Boolean)){await jsonCheck(c.type+' conversation',`/api/v1/conversations/${c.id}`,ChatEndpoints.getConversation.response);await jsonCheck(c.type+' messages',`/api/v1/conversations/${c.id}/messages?limit=30`,ChatEndpoints.listMessages.response);}
 const feed=await jsonCheck('moments feed','/api/v1/moments/feed?limit=5',MomentsEndpoints.listFeed.response);
 if(feed.items?.length)await jsonCheck('moment detail',`/api/v1/moments/posts/${feed.items[0].postId}`,MomentsEndpoints.getPost.response);
 const memory=(await db.query('SELECT character_id,count(*) n FROM ai_runtime.memories WHERE user_id=$1 GROUP BY character_id ORDER BY n DESC LIMIT 1',[OWNER])).rows[0];
 if(memory)await jsonCheck('memories',`/api/v1/characters/${memory.character_id}/memories?limit=5`,MemoryEndpoints.list.response);
 const image=(await db.query("SELECT id FROM media.objects WHERE owner_id=$1 AND state='ready' AND mime_type LIKE 'image/%' ORDER BY created_at LIMIT 1",[OWNER])).rows[0];
 const audio=(await db.query("SELECT id FROM media.objects WHERE owner_id=$1 AND state='ready' AND mime_type LIKE 'audio/%' ORDER BY created_at LIMIT 1",[OWNER])).rows[0];
 if(!image||!audio)throw new Error('MIGRATED_IMAGE_AND_AUDIO_REQUIRED');
 await mediaCheck('historical image',image.id);await mediaCheck('historical audio',audio.id);
 const avatar=(await db.query('SELECT avatar_media_id id FROM characters.characters WHERE owner_id IS NULL AND avatar_media_id IS NOT NULL LIMIT 1')).rows[0];if(avatar)await mediaCheck('character avatar',avatar.id);
 }
 const foreignMedia=(await db.query("SELECT id FROM media.objects WHERE owner_id IS NOT NULL AND owner_id<>$1 AND state='ready' LIMIT 1",[OWNER])).rows[0];
 const foreignConversation=(await db.query('SELECT id FROM chat.conversations WHERE owner_user_id<>$1 AND last_seq>0 LIMIT 1',[OWNER])).rows[0];
 const foreignPost=(await db.query('SELECT id FROM moments.posts WHERE owner_user_id<>$1 LIMIT 1',[OWNER])).rows[0];
 if(foreignMedia&&!isolationOnly)await jsonCheck('other user media denied',`/api/v1/media/${foreignMedia.id}`,null,404);
 if(foreignConversation)await jsonCheck('other user conversation denied',`/api/v1/conversations/${foreignConversation.id}`,null,[403,404]);
 if(foreignPost)await jsonCheck('other user moments denied',`/api/v1/moments/posts/${foreignPost.id}`,null,[403,404]);
 if(isolationOnly){const original=JSON.parse(fs.readFileSync(REPORT,'utf8'));fs.copyFileSync(REPORT,REPORT.replace('.json','-first.json'));checks.unshift(...original.checks.filter(c=>c.ok));}
 const report={ok:true,checkedAt:new Date().toISOString(),checks};fs.writeFileSync(REPORT,JSON.stringify(report,null,2),{mode:0o600});process.stdout.write(JSON.stringify(report)+'\n');
}
main().catch(error=>{const report={ok:false,code:error.message,checks};fs.writeFileSync(REPORT,JSON.stringify(report,null,2),{mode:0o600});process.stdout.write(JSON.stringify(report)+'\n');process.exitCode=1;}).finally(async()=>{if(created)await db.query('DELETE FROM identity.sessions WHERE id=$1 AND user_id=$2',[sessionId,OWNER]);await db.close();});
