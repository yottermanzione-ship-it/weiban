/** JSON Schema is the only DTO source. Never edit the generated Kotlin. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const document = JSON.parse(readFileSync(resolve(root, 'packages/contracts/generated/json-schema.json'), 'utf8'));
const definitions = document.$defs;
const output = resolve(root, 'apps/android/core/contracts-generated/src/main/kotlin/app/weiban/contracts/Contracts.kt');
const check = process.argv.includes('--check');
const names = new Map();
const used = new Set();
function name(value) {
  if (names.has(value)) return names.get(value);
  let result = value.split(/[^a-zA-Z0-9]+/).map(x => x ? x[0].toUpperCase()+x.slice(1) : '').join('');
  if (!/^[A-Za-z]/.test(result)) result = `Schema${result}`;
  while(used.has(result)) result += 'Value';
  used.add(result); names.set(value,result); return result;
}
for (const key of Object.keys(definitions).sort()) name(key);
function reference(s) { return s.$ref?.replace('#/$defs/', ''); }
function dereference(s, seen = new Set()) {
  const ref = reference(s);
  if (!ref || seen.has(ref)) return s;
  return dereference(definitions[ref], new Set([...seen,ref]));
}
function intersect(a,b) {
  a = normalize(a); b = normalize(b);
  const av=a.oneOf??a.anyOf, bv=b.oneOf??b.anyOf;
  if (av) return {oneOf:av.map(x=>intersect(x,b))};
  if (bv) return {oneOf:bv.map(x=>intersect(a,x))};
  if (a.type==='object' && b.type==='object') return {type:'object',properties:{...a.properties,...b.properties},required:[...new Set([...(a.required??[]),...(b.required??[])])]};
  if (Object.keys(a).length===0) return b;
  throw new Error('Unsupported intersection: '+JSON.stringify([a,b]).slice(0,200));
}
function normalize(s) {
  s=dereference(s);
  if(Array.isArray(s.type))return {anyOf:s.type.map(t=>({...s,type:t}))};
  if(s.allOf) return s.allOf.reduce(intersect,{});
  return s;
}
const lines = ['// GENERATED from packages/contracts JSON Schema. DO NOT EDIT.', `// Contract ${document.contractVersion}. Regenerate: pnpm android:generate`, '@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)', 'package app.weiban.contracts', '', 'import kotlinx.serialization.*', 'import kotlinx.serialization.descriptors.*', 'import kotlinx.serialization.encoding.*', 'import kotlinx.serialization.json.*', '', `const val CONTRACT_VERSION: String = ${JSON.stringify(document.contractVersion)}`, ''];
const queue = Object.keys(definitions).sort().map(key => [name(key), definitions[key]]);
const emitted = new Set();
function inline(label,s) {
  const n=name(label);if(!emitted.has(n) && !queue.some(([q])=>q===n))queue.push([n,s]); return n;
}
function type(s,label) {
  const ref=reference(s);if(ref)return name(ref);
  if(Array.isArray(s.type))return type(normalize(s),label);
  if(s.type==='null')return 'JsonElement?';
  const variants=s.anyOf??s.oneOf;
  if(variants) {
    const remaining=variants.filter(x=>x.type!=='null');
    if(remaining.length===1)return type(remaining[0],label)+(remaining.length<variants.length?'?':'');
    if(remaining.every(x=>normalize(x).type==='string'))return 'String'+(remaining.length<variants.length?'?':'');
    return inline(label,s);
  }
  if(s.allOf)return inline(label,s);
  switch(s.type) {
    case 'string': return 'String';
    case 'integer': return 'Long';
    case 'number': return Number.isInteger(s.const) ? 'Long' : 'Double';
    case 'boolean': return 'Boolean';
    case 'array': return `List<${type(s.items??{},label+'Item')}>`;
    case 'object':
      if(s.properties)return inline(label,s);
      return `Map<String, ${type(typeof s.additionalProperties==='object'?s.additionalProperties:{},label+'Value')}>`;
    default:return 'JsonElement';
  }
}
function object(n,s,overrides=new Set()) {
  const fields=Object.entries(s.properties??{});
  if(fields.length===0){lines.push(`@Serializable class ${n}`, '');return;}
  lines.push('@Serializable',`data class ${n}(`);
  for(const [key,v] of fields) {
    const required=(s.required??[]).includes(key);
    let t=type(v,n+key[0].toUpperCase()+key.slice(1));
    if(!required&&!t.endsWith('?'))t+='?';
    const literal=v.const;
    if(literal!==undefined)lines.push('    @EncodeDefault');
    lines.push(`    @SerialName(${JSON.stringify(key)}) ${overrides.has(key)?'override ':''}val \`${key}\`: ${t}${literal!==undefined?' = '+JSON.stringify(literal):required?'':' = null'},`);
  }
  lines.push(')', '');
}
for(let i=0;i<queue.length;i++) {
  const [n,raw]=queue[i];if(emitted.has(n))continue;emitted.add(n);
  const s=normalize(raw);
  const branches=s.oneOf??s.anyOf;
  if(branches) {
    const nonnull=branches.filter(x=>x.type!=='null').map(normalize);
    if(nonnull.length===1) {lines.push(`typealias ${n} = ${type(branches[0].type==='null'?branches[1]:branches[0],n+'Value')}${nonnull.length<branches.length?'?':''}`, '');continue;}
    const discriminants=nonnull.map(x=>x.properties?.type?.const);
    if(discriminants.every(x=>typeof x==='string') && new Set(discriminants).size===discriminants.length) {
      const common=new Map();
      for(const [key,spec] of Object.entries(nonnull[0].properties)) {
        const specs=nonnull.map(branch=>branch.properties?.[key]);
        if(specs.every(s=>s && (key==='type' || JSON.stringify(s)===JSON.stringify(spec)))) {
          let t=type(spec,n+key[0].toUpperCase()+key.slice(1));
          if(nonnull.some(branch=>!(branch.required??[]).includes(key)) && !t.endsWith('?'))t+='?';
          common.set(key,t);
        }
      }
      lines.push(`@Serializable(with = ${n}Serializer::class)`, `sealed interface ${n} {`);
      for(const [key,t] of common) lines.push(`    val \`${key}\`: ${t}`);
      lines.push('}', '');
      const cases=[];
      for(let j=0;j<nonnull.length;j++) {
        const child=name(n+'_'+discriminants[j]);
        const before=lines.length;object(child,nonnull[j],new Set(common.keys()));
        // Child implements exactly this union; discriminator remains a serialized field.
        const end=lines.lastIndexOf(')');if(end<before)throw new Error('Empty tagged case');
        lines[end]=`) : ${n}`;cases.push([discriminants[j],child]);
      }
      lines.push(`object ${n}Serializer : KSerializer<${n}> {`, `    override val descriptor: SerialDescriptor = buildClassSerialDescriptor(${JSON.stringify(n)})`, `    override fun deserialize(decoder: Decoder): ${n} {`, '        val input = decoder as JsonDecoder', '        var value = input.decodeJsonElement().jsonObject', '        val tag = value["type"]?.jsonPrimitive?.content', '        return when (tag) {');
      for(const [tag,child] of cases)lines.push(`            ${JSON.stringify(tag)} -> input.json.decodeFromJsonElement(${child}.serializer(), value)`);
      const fallback=cases.find(([tag])=>tag==='unsupported');
      if(fallback) {
        const fallbackSchema=nonnull[discriminants.indexOf('unsupported')];
        const payload=fallbackSchema.properties.originalType ? '"originalType" to JsonPrimitive(tag)' : '"data" to buildJsonObject { put("originalType", tag) }';
        lines.push(`            else -> { require(tag != null) { "Missing discriminator" }; value = JsonObject(value + mapOf("type" to JsonPrimitive("unsupported"), ${payload})); input.json.decodeFromJsonElement(${fallback[1]}.serializer(), value) }`);
      }
      else lines.push('            else -> throw SerializationException("Unknown discriminator")');
      lines.push('        }','    }',`    override fun serialize(encoder: Encoder, value: ${n}) {`, '        val output = encoder as JsonEncoder', '        val element = when (value) {');
      for(const [,child] of cases)lines.push(`            is ${child} -> output.json.encodeToJsonElement(${child}.serializer(), value)`);
      lines.push('        }','        output.encodeJsonElement(element)','    }','}', '');
    } else if(nonnull.every(x=>x.type==='string'))lines.push(`typealias ${n} = String`, '');
    else lines.push(`typealias ${n} = JsonElement`, ''); // untagged heterogeneous JSON, e.g. settings values
  } else if(s.type==='object'&&s.properties)object(n,s);
  else if(reference(raw)&&name(reference(raw))!==n)lines.push(`typealias ${n} = ${name(reference(raw))}`, '');
  else if(s.type==='array')lines.push(`typealias ${n} = ${type(s,n+'Value')}`, '');
  else if(s.type==='object')lines.push(`typealias ${n} = ${type(s,n+'Value')}`, '');
  else lines.push(`typealias ${n} = ${type(s,n+'Value')}`, '');
}
const kotlin = lines.join('\n')+'\n';
if(check) {
  if(readFileSync(output,'utf8')!==kotlin)throw new Error('Generated Kotlin differs');
} else {mkdirSync(dirname(output),{recursive:true});writeFileSync(output,kotlin);}
const resources=resolve(root,'apps/android/core/contracts-generated/src/main/resources/contracts.json');
const source=JSON.stringify(document)+'\n';
if(check){if(readFileSync(resources,'utf8')!==source)throw new Error('Generated schema differs');}
else{mkdirSync(dirname(resources),{recursive:true});writeFileSync(resources,source);}
console.log(`Kotlin contracts ${document.contractVersion}: ${emitted.size} named definitions`);
const endpointFile=resolve(dirname(output),'Endpoints.kt');
const endpointLines=['// GENERATED from contracts. DO NOT EDIT.','package app.weiban.contracts','', 'import kotlinx.serialization.KSerializer','import kotlinx.serialization.serializer','', 'data class ContractEndpoint<T>(val id: String, val method: String, val path: String, val auth: String, val responseSchema: String, val bodySchema: String?, val response: KSerializer<T>)','', 'object Endpoints {'];
for(const endpoint of document.endpoints) {
  const t=name(reference(endpoint.response));
  const n=name(endpoint.id);const property=n[0].toLowerCase()+n.slice(1);
  endpointLines.push(`    val ${property} = ContractEndpoint<${t}>(${JSON.stringify(endpoint.id)}, ${JSON.stringify(endpoint.method)}, ${JSON.stringify(endpoint.path)}, ${JSON.stringify(endpoint.auth)}, ${JSON.stringify(reference(endpoint.response))}, ${endpoint.body ? JSON.stringify(reference(endpoint.body)) : 'null'}, serializer<${t}>())`);
}
endpointLines.push('}','');const endpointSource=endpointLines.join('\n');
if(check){if(readFileSync(endpointFile,'utf8')!==endpointSource)throw new Error('Generated endpoints differ');}
else writeFileSync(endpointFile,endpointSource);
