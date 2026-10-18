// 生成 UI 总账页面：把 401 条总对照表、总经理逐行批注、11 号改造方案合成一页。
// 数据源：docs/refactor/08-master-map.json、10-gm-review-annotations.md、11-plan-and-open-topics.md
// 用法：node docs/web/ui-ledger-2026-10-18/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const rows = JSON.parse(readFileSync(join(root, 'docs/refactor/08-master-map.json'), 'utf8'));
const annotations = readFileSync(join(root, 'docs/refactor/10-gm-review-annotations.md'), 'utf8');
const plan = readFileSync(join(root, 'docs/refactor/11-plan-and-open-topics.md'), 'utf8');

const verdictById = new Map();
for (const line of annotations.split('\n')) {
  const m = line.match(/^- \*\*(T\d(?:\.\d+)*|G\d(?:\.\d+)*)[^*]*\*\*.*?—\s*(要改|不要|确认)(?:：\s*(.*))?$/);
  if (!m) continue;
  verdictById.set(m[1], { verdict: m[2], note: (m[3] ?? '').trim() });
}

const planById = new Map();
let section = null;
let inB = false;
for (const line of plan.split('\n')) {
  if (/^## B\./.test(line)) {
    inB = true;
    section = null;
    continue;
  }
  if (/^## C\./.test(line)) {
    inB = false;
    section = null;
    continue;
  }
  const h = line.match(/^### ([AB])(\d+)\.\s*(.+)$/);
  if (h) {
    inB = false;
    section = `${h[1]}${h[2]} ${h[3].trim()}`;
  }
  if (!section && !inB) continue;
  const key = inB ? 'B 待总经理定' : section;
  for (const m of line.matchAll(/(?:T|G)\d(?:\.\d+)*/g)) {
    if (!planById.has(m[0])) planById.set(m[0], key);
  }
}

const data = rows.map((r) => {
  const a = verdictById.get(r.id);
  const plan = planById.get(r.id) ?? '';
  const impl = !plan ? '待核' : plan.startsWith('A') ? '已排入A批次' : '待总经理定';
  return {
    id: r.id,
    tab: r.tab,
    path: r.path,
    node: r.node,
    interaction: r.interaction,
    status: r.status,
    verdict: a?.verdict ?? '确认',
    note: a?.note ?? (r.note ?? ''),
    plan,
    impl,
  };
});

const count = (key) => data.reduce((acc, x) => ((acc[x[key]] = (acc[x[key]] ?? 0) + 1), acc), {});
const tabs = ['微信', '通讯录', '发现', '我', '全局'];
const statuses = ['已有且一致', '已有需调整', '缺失', '不需要'];
const verdicts = ['确认', '要改', '不要'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>微伴 UI 总账 · 401 条</title>
<style>
:root{--bg:#EDEDED;--card:#fff;--line:#E5E5E5;--text:#191919;--sub:#7A7A7A;--green:#07C160;--amber:#FA9D3B;--red:#FA5151;--blue:#576B95}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
header{background:var(--card);padding:20px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
h1{margin:0 0 4px;font-size:18px;font-weight:500}
.meta{color:var(--sub);font-size:12px}
.cards{display:flex;gap:12px;margin-top:14px;flex-wrap:wrap}
.card{background:#F7F7F7;border-radius:8px;padding:10px 14px;min-width:96px}
.card b{display:block;font-size:20px;font-weight:500;line-height:1.3}
.card span{color:var(--sub);font-size:12px}
.filters{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center}
select,input{font:inherit;font-size:13px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--text)}
input{min-width:200px}
main{padding:16px 24px 60px}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#FAFAFA;font-weight:500;font-size:12px;color:var(--sub);position:sticky;top:0}
td.id{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--blue);white-space:nowrap}
td.node{font-weight:500;min-width:140px}
td.path,td.inter{color:var(--sub);font-size:12px}
.tag{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;white-space:nowrap}
.s-ok{background:#E8F8EE;color:#0B8A45}
.s-fix{background:#FFF4E5;color:#B26A00}
.s-miss{background:#FDECEC;color:#C33}
.s-no{background:#F0F0F0;color:#777}
.v-fix{background:#FFF4E5;color:#B26A00}
.v-no{background:#FDECEC;color:#C33}
.v-ok{background:#F0F0F0;color:#777}
.plan{font-size:12px;color:var(--sub)}
.note{font-size:12px;color:#333;margin-top:2px}
.i-a{background:#E8F8EE;color:#0B8A45}
.i-b{background:#EEF3FB;color:#3A5A8C}
.i-x{background:#F0F0F0;color:#777}
.empty{color:var(--sub);padding:24px}
</style>
</head>
<body>
<header>
<h1>微伴 UI 总账</h1>
<div class="meta">数据源：08 总对照表 401 行 · 10 总经理逐行批注 · 11 改造方案（2026-10-14）　|　生成于 2026-10-18</div>
<div class="cards">
  <div class="card"><b>${data.length}</b><span>总条目</span></div>
  ${statuses.map((s) => `<div class="card"><b>${count('status')[s] ?? 0}</b><span>${s}</span></div>`).join('')}
  ${verdicts.map((v) => `<div class="card"><b>${count('verdict')[v] ?? 0}</b><span>批注：${v}</span></div>`).join('')}
</div>
<div class="filters">
  <select id="tab"><option value="">全部页面</option>${tabs.map((t) => `<option>${t}</option>`).join('')}</select>
  <select id="status"><option value="">全部现状</option>${statuses.map((s) => `<option>${s}</option>`).join('')}</select>
  <select id="verdict"><option value="">全部批注</option>${verdicts.map((v) => `<option>${v}</option>`).join('')}</select>
  <input id="q" placeholder="搜索名称、路径、批注">
  <span class="meta" id="shown"></span>
</div>
</header>
<main>
<table>
<thead><tr><th>编号</th><th>页面</th><th>位置 / 节点</th><th>现状</th><th>批注</th><th>改造方案归属</th><th>实施</th></tr></thead>
<tbody id="body"></tbody>
</table>
<div class="empty" id="empty" style="display:none">没有匹配的条目</div>
</main>
<script>
const DATA = ${JSON.stringify(data)};
const body = document.getElementById('body');
const cls = { '已有且一致': 's-ok', '已有需调整': 's-fix', '缺失': 's-miss', '不需要': 's-no' };
const vcls = { '确认': 'v-ok', '要改': 'v-fix', '不要': 'v-no' };
function render() {
  const t = document.getElementById('tab').value;
  const s = document.getElementById('status').value;
  const v = document.getElementById('verdict').value;
  const q = document.getElementById('q').value.trim().toLowerCase();
  const list = DATA.filter((r) =>
    (!t || r.tab === t) && (!s || r.status === s) && (!v || r.verdict === v) &&
    (!q || (r.id + r.node + r.path + r.interaction + r.note + r.plan).toLowerCase().includes(q)));
  body.innerHTML = list.map((r) => \`<tr>
    <td class="id">\${r.id}</td>
    <td class="path">\${r.tab} › \${r.path}</td>
    <td class="node">\${r.node}<div class="inter">\${r.interaction || ''}</div></td>
    <td><span class="tag \${cls[r.status] || 's-no'}">\${r.status}</span></td>
    <td><span class="tag \${vcls[r.verdict] || 'v-ok'}">\${r.verdict}</span>\${r.note ? \`<div class="note">\${r.note}</div>\` : ''}</td>
    <td class="plan">\${r.plan || '—'}</td>
    <td><span class="tag \${r.impl === '已排入A批次' ? 'i-a' : r.impl === '待总经理定' ? 'i-b' : 'i-x'}">\${r.impl}</span></td>
  </tr>\`).join('');
  document.getElementById('shown').textContent = \`显示 \${list.length} / \${DATA.length}\`;
  document.getElementById('empty').style.display = list.length ? 'none' : 'block';
}
['tab','status','verdict','q'].forEach((id) => document.getElementById(id).addEventListener('input', render));
render();
</script>
</body>
</html>`;

mkdirSync(here, { recursive: true });
writeFileSync(join(here, 'index.html'), html);
const summary = { total: data.length, status: count('status'), verdict: count('verdict'), planned: data.filter((d) => d.plan).length };
writeFileSync(join(here, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
