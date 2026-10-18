// 仅生成事实台账；不推断产品已完成，不访问数据库或应用API。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const sources = {
  map: 'docs/refactor/08-master-map.json',
  annotations: 'docs/refactor/10-gm-review-annotations.md',
  plan: 'docs/refactor/11-plan-and-open-topics.md',
};
const rows = JSON.parse(read(sources.map)),
  lines = read(sources.annotations).split(/\r?\n/),
  planLines = read(sources.plan).split(/\r?\n/);
const notes = JSON.parse(
  readFileSync(resolve(here, 'review-notes.json'), 'utf8'),
).notes;
const byId = new Map(),
  unknownLines = [];
lines.forEach((raw, i) => {
  if (!/^- \*\*[TG]\d/.test(raw)) return;
  const m = raw.match(
    /^- \*\*([TG]\d+(?:\.\d+)*)[^*]*\*\*.*?—\s*(要改|不要|确认|未标)(?:：\s*(.*))?\s*$/,
  );
  if (!m) {
    unknownLines.push({ line: i + 1, raw });
    return;
  }
  if (byId.has(m[1])) throw Error('duplicate annotation ' + m[1]);
  byId.set(m[1], { verdict: m[2], note: m[3] ?? '', line: i + 1, raw });
});
const ids = new Set(rows.map((r) => r.id));
if (ids.size !== 401 || rows.length !== 401)
  throw Error('Expected 401 unique rows');
for (const id of byId.keys())
  if (!ids.has(id)) throw Error('Unknown annotation ' + id);
if (unknownLines.length)
  throw Error('Unparsed annotation ' + JSON.stringify(unknownLines));
for (const [id, n] of Object.entries(notes)) {
  if (!ids.has(id)) throw Error('Unknown review ' + id);
  for (const ref of n.refs) {
    if (
      !existsSync(resolve(root, ref.path)) ||
      !read(ref.path).includes(ref.quote)
    )
      throw Error('Stale/missing evidence ' + id + ' ' + ref.path);
    ref.line = read(ref.path)
      .slice(0, read(ref.path).indexOf(ref.quote))
      .split(/\r?\n/).length;
  }
}
// 计划只是引用关系：直接ID与斜杠简称展开分别注明，不扩展父级/range为实施证据。
const planRefs = new Map();
let area = '',
  section = '';
planLines.forEach((raw, i) => {
  const h = raw.match(/^## ([ABC])\./);
  if (h) {
    area = h[1];
    section = '';
  }
  const sub = raw.match(/^### (A\d+)\.?\s*(.*)/);
  if (sub) section = sub[1];
  if (!['A', 'B'].includes(area)) return;
  for (const m of raw.matchAll(/\b([TG]\d+(?:\.\d+)*)(\/\d+(?:\/\d+)*)?/g)) {
    const list = [{ id: m[1], via: '直接ID' }];
    if (m[2])
      for (const tail of m[2].slice(1).split('/'))
        list.push({ id: m[1].replace(/\d+$/, tail), via: '斜杠简称展开' });
    for (const { id, via } of list) {
      if (!ids.has(id)) continue;
      const refs = planRefs.get(id) ?? [];
      refs.push({
        section: section || 'B议题（历史）',
        path: sources.plan,
        line: i + 1,
        via,
        quote: raw.trim(),
      });
      planRefs.set(id, refs);
    }
  }
});
const decisions = {
  B1: {
    ids: 'T1.16.12 T2.12.10',
    label: 'C1已定成长方向；关系系统实现后端冻结',
    section: 'C1 B1 / C9',
  },
  B2: {
    ids: 'T4.2.8 T1.16.13',
    label: 'C9生态只做讨论UI；动作/定价细节待讨论，后端冻结',
    section: 'C3 / C9',
  },
  B3: {
    ids: 'T2.14.1 T2.14.2',
    label: 'C1已定先调研角色卡；字段未最终定，会员付费C9冻结',
    section: 'C1 B3 / C9',
  },
  B4: {
    ids: 'T1.10.6',
    label: 'C1已定独立决策方向；真实接入后端冻结',
    section: 'C1 B4 / C9',
  },
  B5: {
    ids: 'T1.12.2 T1.16.8',
    label: 'C1已定时机方向；执行/收费链冻结，UI可核',
    section: 'C1 B5 / C9',
  },
  B6: {
    ids: 'T1.16.6',
    label: 'C1已定去信息页小程序行；纯UI可核',
    section: 'C1 B6',
  },
  B7: {
    ids: 'T1.16.14',
    label: 'C1克隆暂缓/自定义预设方向已定；不重开选择题',
    section: 'C1 B7 / C9',
  },
  B8: {
    ids: 'T1.16.9 T4.2.9 T1.10.4',
    label: 'C1已定动作约束/标点方向；内核冻结，UI可核',
    section: 'C1 B8 / C9',
  },
  B9: {
    ids: 'T1.8 T4.10.9',
    label: 'C1官方助手方向已定；会员方案C9重新冻结',
    section: 'C1 B9 / C9',
  },
  B10: {
    ids: 'T2.2',
    label: 'C1候选引擎方向已定；不加别名字段，后端冻结',
    section: 'C1 B10 / C9',
  },
  B11: {
    ids: 'T2.14.3',
    label: 'C1先搜索/极简申请方向已定；后端冻结',
    section: 'C1 B11 / C9',
  },
};
const overrides = {
  'T1.11.13': {
    label: '后文T1.11.15推翻“不要转文字”：使用已有识别/原文',
    section: '10号 T1.11.15；11 A4',
  },
  ...Object.fromEntries(
    'T4.10.3.1 T4.10.3.2 T4.10.3.3 T4.10.3.4'.split(' ').map((id) => [
      id,
      {
        label: '后文T4.10.3.5：隐私行恢复为暂未开放，不是完全删除',
        section: '10号 T4.10.3.5；11 A9',
      },
    ]),
  ),
  'T4.10.4.7': {
    label: '11 A9改为聊天记录恢复；不要旧迁移流程',
    section: '11 A9',
  },
  'T1.21.2': {
    label: '解散/删除语义见11 A6，不能机械删除必要确认框',
    section: '11 A6',
  },
  'G3.6': { label: '原批注要求暂维持，不列紧急重设计', section: '10号 G3.6' },
};
function product(id) {
  if (overrides[id]) return overrides[id];
  const d = Object.values(decisions).find((d) => d.ids.split(' ').includes(id));
  return d
    ? { label: d.label, section: d.section }
    : {
        label: '沿逐行批注/导出规则；无本轮新增产品裁定',
        section: '10号；11 C9只冻结实现，不自动改原要求',
      };
}
const guidance = (r) =>
  r.verdict === '不要'
    ? '核入口的移除/暂未开放及后文例外；删除后不能误伤应保留入口。'
    : '按原批注核布局、入口、文案、返回、失败/取消；真实能力与纯UI分开登记。';
const ledger = rows.map((row) => {
  const a = byId.get(row.id);
  let parent = row.id;
  const ancestors = [];
  while (parent.includes('.')) {
    parent = parent.slice(0, parent.lastIndexOf('.'));
    if (byId.has(parent))
      ancestors.push({
        id: parent,
        line: byId.get(parent).line,
        verdict: byId.get(parent).verdict,
      });
  }
  const action = !!a && ['要改', '不要'].includes(a.verdict);
  const review = notes[row.id];
  const annotation = {
    verdict: a?.verdict ?? '确认',
    sourceType: a ? '逐行原文' : '导出总说明继承',
    source: { path: sources.annotations, line: a?.line ?? 3 },
    note: a?.note ?? '',
    raw: a?.raw ?? lines[2],
    missingDirect: !a,
    directVerdict: a?.verdict ?? '未批注',
    ancestors,
    parentInheritanceApplied: false,
  };
  const evidence = {
    status: review?.status ?? '未核',
    reviewedAt: review ? '2026-10-18' : null,
    scope:
      review?.scope ?? '本轮没有逐行实施证据；原地图/批注/排期均不代表验收。',
    refs: review?.refs ?? [],
    blockers: review?.blockers ?? [],
    next: review?.next ?? guidance(annotation),
  };
  return {
    id: row.id,
    tab: row.tab,
    path: row.path,
    node: row.node,
    interaction: row.interaction,
    sourceRow: row,
    originalMap: {
      status: row.status,
      asOf: '2026-10-14（原稿日期；不是2026-10-18实现状态）',
      source: sources.map,
    },
    annotation,
    needsAction: action,
    planReferences: planRefs.get(row.id) ?? [],
    productDecision: product(row.id),
    evidence,
  };
});
const count = (fn) =>
  ledger.reduce((a, r) => {
    const k = fn(r);
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});
const actionRows = ledger.filter((r) => r.needsAction);
if (actionRows.length !== 185) throw Error('Expected185');
const metadata = {
  auditedAt: '2026-10-18',
  baseline: '2e92c92fed82eb2eda230454fd45f18297f35149',
  scope: '台账事实核对；未浏览器复点，未改业务',
  exportReportedCounts: { 确认: 209, 要改: 104, 不要: 81, 未标: 7 },
  parsedCounts: { 确认: 211, 要改: 104, 不要: 81, 未标: 5 },
  sources: Object.values(sources).map((path) => ({
    path,
    sha256: createHash('sha256').update(read(path)).digest('hex'),
  })),
  definitions: {
    originalMap: '10月14日静态地图原状，保留完整sourceRow',
    verdict: '批注决定；继承仅依10号导出总说明，不继承父项',
    evidence: '实施证据；无通过状态，未经逐行证据不得销账',
    planReferences: 'A/B只是排期/历史议题引用，不是实施结论',
  },
  discrepancy: {
    declared: { 确认: 209, 要改: 104, 不要: 81, 未标: 7 },
    parsedDirect: { 确认: 25, 要改: 104, 不要: 81, 未标: 5 },
    omitted: 186,
    computedWithExportRule: { 确认: 211, 要改: 104, 不要: 81, 未标: 5 },
    note: '原文总计与逐行差2行；未标仅找到5个ID，禁止为凑统计猜另外2个。',
  },
};
const summary = {
  ...metadata,
  total: ledger.length,
  originalStatus: count((r) => r.originalMap.status),
  verdict: count((r) => r.annotation.verdict),
  annotationSource: count((r) => r.annotation.sourceType),
  evidence: count((r) => r.evidence.status),
  needsAction: actionRows.length,
  actionsWithReview: actionRows.filter((r) => r.evidence.reviewedAt).length,
  actionsWithoutReview: actionRows.filter((r) => !r.evidence.reviewedAt).length,
  directPlanRows: ledger.filter((r) => r.planReferences.length).length,
  actionPlanRows: actionRows.filter((r) => r.planReferences.length).length,
  noBrowserAcceptance: true,
};
writeFileSync(
  resolve(here, 'ledger.json'),
  JSON.stringify({ metadata, rows: ledger }, null, 2) + '\n',
);
writeFileSync(
  resolve(here, 'evidence-map.json'),
  JSON.stringify(
    {
      metadata,
      items: actionRows.map((r) => ({
        id: r.id,
        requirement: r.annotation,
        productDecision: r.productDecision,
        planReferences: r.planReferences,
        evidence: r.evidence,
      })),
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  resolve(here, 'summary.json'),
  JSON.stringify(summary, null, 2) + '\n',
);
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const opts = (values) =>
  values.map((v) => `<option>${esc(v)}</option>`).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>微伴 UI事实台账</title><style>body{margin:0;background:#ededed;color:#191919;font:14px/1.6 system-ui}header,main{padding:16px}header{background:white}h1{font-size:21px;margin:0}.warning{background:#fff4df;padding:12px}label{display:inline-flex;gap:6px;margin:8px}select,input{font:inherit;padding:7px;max-width:100%}.table{overflow:auto}table{border-collapse:collapse;background:white;width:100%}th,td{border:1px solid #ddd;padding:10px;text-align:left;vertical-align:top;min-width:130px}td:first-child{min-width:85px}small{color:#666}details{max-width:500px}summary{cursor:pointer}a{color:#3d619b}.state{background:#eee;padding:3px 7px;white-space:nowrap}</style><header><h1>微伴 UI事实台账 ·401条</h1><p>原地图：2026-10-14；本轮文档/有限源码核对：2026-10-18。排期、决定、历史截图、当前实施证据分开，未进行浏览器验收。</p><p class="warning">10号总计确认209/未标7；可定位原文确认25/未标5＋省略186，按导出总说明计算确认211/未标5。差2条未能定位，不凑数。继承确认不等于通过。</p><p>需动作185条；有本轮逐ID审阅记录${summary.actionsWithReview}条，其余${summary.actionsWithoutReview}条实施未核。<a href="ledger.json">完整JSON</a> · <a href="evidence-map.json">185条映射</a> · <a href="audit.md">核查报告</a></p><label>页面<select id="tab"><option value="">全部</option>${opts([...new Set(ledger.map((r) => r.tab))])}</select></label><label>原稿状态<select id="original"><option value="">全部</option>${opts(Object.keys(summary.originalStatus))}</select></label><label>批注<select id="verdict"><option value="">全部</option>${opts(['确认', '要改', '不要', '未标'])}</select></label><label>批注来源<select id="origin"><option value="">全部</option>${opts(['逐行原文', '导出总说明继承'])}</select></label><label>证据状态<select id="state"><option value="">全部</option>${opts(['未核', '源码已核待点按', '历史截图待复点', '后端冻结', '产品待定'])}</select></label><label>工作集<select id="action"><option value="">401条</option><option value="yes">185需动作</option><option value="unreviewed">需动作且未审阅</option></select></label><label>搜索<input id="q" placeholder="ID/页面/批注/证据/决定"></label><p id="count"></p></header><main><div class="table"><table><thead><tr><th>ID/页面</th><th>节点</th><th>原地图（10-14）</th><th>批注及来源</th><th>最新决定/排期</th><th>实施证据（10-18）</th></tr></thead><tbody id="body"></tbody></table></div></main><script>
const DATA=${JSON.stringify(ledger).replace(/</g, '\\u003c')};
const escapeHtml=${esc.toString()};
const controls=['tab','original','verdict','origin','state','action','q'];
function render(){const v=Object.fromEntries(controls.map(k=>[k,document.getElementById(k).value]));const items=DATA.filter(r=>(!v.tab||r.tab===v.tab)&&(!v.original||r.originalMap.status===v.original)&&(!v.verdict||r.annotation.verdict===v.verdict)&&(!v.origin||r.annotation.sourceType===v.origin)&&(!v.state||r.evidence.status===v.state||r.evidence.blockers.includes(v.state))&&(!v.action||r.needsAction&&(v.action!=='unreviewed'||!r.evidence.reviewedAt))&&(!v.q||JSON.stringify(r).toLowerCase().includes(v.q.toLowerCase())));document.getElementById('count').textContent='显示 '+items.length+' / 401；没有条目被标为验收通过';document.getElementById('body').innerHTML=items.map(r=>'<tr><td>'+escapeHtml(r.id)+'<br>'+escapeHtml(r.tab)+'</td><td>'+escapeHtml(r.node)+'<br><small>'+escapeHtml(r.path)+' / '+escapeHtml(r.interaction)+'</small></td><td>'+escapeHtml(r.originalMap.status)+'<details><summary>完整原始行</summary><pre>'+escapeHtml(JSON.stringify(r.sourceRow,null,2))+'</pre></details></td><td>'+escapeHtml(r.annotation.verdict)+'<br><small>'+escapeHtml(r.annotation.sourceType)+' · 10号:'+r.annotation.source.line+'</small><p>'+escapeHtml(r.annotation.note)+'</p><small>父项关联（不继承）：'+escapeHtml(r.annotation.ancestors.map(a=>a.id).join('、')||'无')+'</small></td><td>'+escapeHtml(r.productDecision.label)+'<br><small>'+escapeHtml(r.productDecision.section)+'</small><details><summary>计划引用 '+r.planReferences.length+' 条（非实施）</summary>'+r.planReferences.map(p=>'<p>'+escapeHtml(p.section)+' · 11号:'+p.line+' '+escapeHtml(p.via)+'</p>').join('')+'</details></td><td><span class="state">'+escapeHtml(r.evidence.status)+'</span><p>'+escapeHtml(r.evidence.scope)+'</p>'+r.evidence.refs.map(p=>'<p><small>'+escapeHtml(p.kind)+'：'+escapeHtml(p.path)+':'+p.line+'<br>'+escapeHtml(p.quote)+'</small></p>').join('')+'<p>限制：'+escapeHtml(r.evidence.blockers.join('、')||'浏览器待验')+'</p><small>下一步：'+escapeHtml(r.evidence.next)+'</small></td></tr>').join('');}controls.forEach(k=>document.getElementById(k).addEventListener('input',render));render();</script></html>`;
writeFileSync(resolve(here, 'index.html'), html);
console.log(
  JSON.stringify(
    {
      total: summary.total,
      verdict: summary.verdict,
      evidence: summary.evidence,
      needsAction: 185,
      actionsWithReview: summary.actionsWithReview,
      directPlanRows: summary.directPlanRows,
      actionPlanRows: summary.actionPlanRows,
      unknownAnnotationLines: unknownLines.length,
    },
    null,
    2,
  ),
);
