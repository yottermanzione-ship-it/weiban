#!/usr/bin/env node
/**
 * 微伴设计令牌生成脚本
 *
 * 做什么：从唯一来源 docs/design/tokens.json 生成网页 CSS 变量和安卓 Kotlin 常量。
 * 谁维护：生成逻辑由设计负责人定（T-012 参考实现）；脚本位置、根脚本和 CI 接入由运维负责人维护（T-015）。
 * 格式说明：docs/design/tokens-android.md。只用 Node 自带模块，无需安装依赖。
 *
 * 参数：
 *   --css <路径>     网页用 CSS 变量（仓库里的成品在 docs/design/tokens.css）
 *   --kotlin <路径>  安卓 Jetpack Compose 常量（Kotlin 源文件）
 *   --package <包名> Kotlin 包名（默认 app.weiban.designsystem.tokens）
 *   --check          只检查、不写文件：tokens.json 自身一致（主题键一致、引用都存在）；
 *                    同时给了 --css / --kotlin 时，还检查这些文件和「重新生成的结果」完全一致，
 *                    不一致就报错退出（说明有人改了 tokens.json 没重新生成，或手改了生成物）。
 *
 * 怎么运行（项目根目录）：
 *   pnpm tokens            重新生成 docs/design/tokens.css
 *   pnpm tokens --check    检查 docs/design/tokens.css 是否最新（CI 和 pnpm check 都会跑）
 *   node scripts/build-tokens.mjs --kotlin apps/android/.../WbTokens.kt
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const tokens = JSON.parse(readFileSync(resolve(here, '../docs/design/tokens.json'), 'utf8'));

// ---------- 工具 ----------
const kebab = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
const pascal = (s) => String(s).replace(/(^|[-_.])([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const camelJoin = (parts) =>
  parts.map((p, i) => (i === 0 ? String(p) : pascal(String(p)))).join('');
const isToken = (o) => o && typeof o === 'object' && '$value' in o;

/** 遍历令牌树，回调 (路径数组, 令牌) */
function walk(node, path, cb) {
  if (!node || typeof node !== 'object') return;
  if (isToken(node)) {
    cb(path, node);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$') || k === 'name') continue;
    walk(v, [...path, k], cb);
  }
}

/** 按路径取令牌 */
function getByPath(path) {
  let n = tokens;
  for (const p of path.split('.')) {
    n = n?.[p];
  }
  if (!isToken(n)) throw new Error(`引用不存在：{${path}}`);
  return n;
}

/** 解析出最终的原始值（跟随引用） */
function resolveValue(v, seen = new Set()) {
  if (typeof v === 'string' && /^\{[^}]+\}$/.test(v)) {
    const p = v.slice(1, -1);
    if (seen.has(p)) throw new Error(`循环引用：${p}`);
    seen.add(p);
    return resolveValue(getByPath(p).$value, seen);
  }
  return v;
}

// 原始色板 → CSS 变量名：primitive.color.pink.500 → --wb-pink-500；support.01.bg → --wb-support-01-bg
const primitiveVar = (path) => `--wb-${path.slice(2).map(kebab).join('-')}`;
function cssValue(v) {
  if (typeof v === 'string' && /^\{primitive\.color\.[^}]+\}$/.test(v)) {
    return `var(${primitiveVar(v.slice(1, -1).split('.'))})`;
  }
  if (typeof v === 'string' && /^\{[^}]+\}$/.test(v)) return cssValue(resolveValue(v));
  if (Array.isArray(v)) return `cubic-bezier(${v.join(', ')})`;
  return String(v);
}

// ---------- 检查：每个主题 × 模式的键集合必须一致 ----------
const themeIds = Object.keys(tokens.theme).filter((k) => !k.startsWith('$'));
const modes = tokens.meta.modes;
const keySet = (node) => {
  const s = [];
  walk(node, [], (p) => s.push(p.join('.')));
  return s.sort().join('|');
};
const refKeys = keySet(tokens.theme[themeIds[0]][modes[0]]);
for (const t of themeIds)
  for (const m of modes) {
    if (keySet(tokens.theme[t][m]) !== refKeys)
      throw new Error(`主题 ${t}.${m} 的键与 ${themeIds[0]}.${modes[0]} 不一致`);
  }
if (keySet(tokens.semantic.light) !== keySet(tokens.semantic.dark))
  throw new Error('semantic.light 与 semantic.dark 的键不一致');
walk(tokens, [], (p, t) => {
  resolveValue(t.$value);
}); // 引用全部可解析

// ---------- CSS ----------
function cssLines(node, prefix) {
  const out = [];
  walk(node, [], (p, t) =>
    out.push(`  --wb-${[...prefix, ...p].map(kebab).join('-')}: ${cssValue(t.$value)};`),
  );
  return out;
}
function buildCss() {
  const L = [];
  const defaultTheme = themeIds.find((t) => tokens.meta.themes[t]?.default) ?? themeIds[0];
  L.push('/*');
  L.push(` * 微伴设计令牌 v${tokens.meta.version} — CSS 版本`);
  L.push(' * 由 scripts/build-tokens.mjs 从 docs/design/tokens.json 生成，请勿手改。');
  L.push(' * 用法：页面只通过 var(--wb-*) 使用数值。');
  L.push(` * 主题：<html data-theme="${themeIds.join('|')}">，不写 = ${defaultTheme}。`);
  L.push(' * 深浅模式：<html data-scheme="light|dark">，不写 = 跟随系统。');
  L.push(' * 字体大小：在 <html> 上改 --wb-font-scale（0.9 / 1 / 1.1 / 1.2 / 1.35）。');
  L.push(' */', '');
  L.push(':root {');
  L.push('  /* ---------- 原始色板（组件不要直接用） ---------- */');
  walk(tokens.primitive.color, ['primitive', 'color'], (p, t) =>
    L.push(`  ${primitiveVar(p)}: ${t.$value};`),
  );
  L.push(
    '',
    `  /* ---------- 默认主题（${defaultTheme}）浅色 + 模式颜色浅色 ---------- */`,
    '  color-scheme: light;',
  );
  L.push(...cssLines(tokens.theme[defaultTheme].light, []));
  L.push(...cssLines(tokens.semantic.light, []));
  L.push(...cssLines(tokens.shadow.light, ['shadow']));
  L.push('', '  /* ---------- 分享图固定色 ---------- */');
  L.push(...cssLines(tokens.share, ['share']));
  L.push('', '  /* ---------- 字体 ---------- */', '  --wb-font-scale: 1;');
  walk(tokens.typography.fontFamily, [], (p, t) =>
    L.push(`  --wb-font-family-${kebab(p[0])}: ${t.$value};`),
  );
  walk(tokens.typography.fontSize, [], (p, t) =>
    L.push(`  --wb-font-size-${kebab(p[0])}: calc(${t.$value} * var(--wb-font-scale));`),
  );
  L.push(...cssLines(tokens.typography.lineHeight, ['line-height']));
  L.push(...cssLines(tokens.typography.fontWeight, ['font-weight']));
  L.push('', '  /* ---------- 间距、圆角、尺寸 ---------- */');
  L.push(...cssLines(tokens.space, ['space']));
  L.push(...cssLines(tokens.radius, ['radius']));
  L.push(...cssLines(tokens.size, ['size']));
  L.push('', '  /* ---------- 动效（只用于 transform / opacity） ---------- */');
  L.push(...cssLines(tokens.motion, ['motion']));
  L.push('', '  /* ---------- 其他 ---------- */');
  L.push(...cssLines(tokens.opacity, ['opacity']));
  L.push(...cssLines(tokens.zIndex, ['z-index']));
  L.push('  /* 断点仅作记录：媒体查询不能读取变量，请直接写数值 */');
  L.push(...cssLines(tokens.breakpoint, ['breakpoint']));
  L.push('}', '');

  const darkBody = (theme) => [
    '    color-scheme: dark;',
    ...cssLines(tokens.theme[theme].dark, []).map((l) => '  ' + l),
    ...cssLines(tokens.semantic.dark, []).map((l) => '  ' + l),
    ...cssLines(tokens.shadow.dark, ['shadow']).map((l) => '  ' + l),
  ];
  const unindent = (lines) => lines.map((l) => l.replace(/^ {2}/, ''));

  L.push(`/* ---------- 深色模式（默认主题）：跟随系统 + 手动指定，两段内容相同 ---------- */`);
  L.push(
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-scheme="light"]) {',
    ...darkBody(defaultTheme),
    '  }',
    '}',
  );
  L.push(':root[data-scheme="dark"] {', ...unindent(darkBody(defaultTheme)), '}', '');

  for (const t of themeIds.filter((x) => x !== defaultTheme)) {
    L.push(
      `/* ---------- 主题：${t}（${tokens.meta.themes[t]?.name ?? ''}）只覆盖 bg / text / border / brand / bubble 五组 ---------- */`,
    );
    L.push(`:root[data-theme="${t}"] {`, ...cssLines(tokens.theme[t].light, []), '}');
    const dark = cssLines(tokens.theme[t].dark, []);
    L.push(
      '@media (prefers-color-scheme: dark) {',
      `  :root[data-theme="${t}"]:not([data-scheme="light"]) {`,
      ...dark.map((l) => '  ' + l),
      '  }',
      '}',
    );
    L.push(`:root[data-theme="${t}"][data-scheme="dark"] {`, ...dark, '}', '');
  }
  L.push('/* ---------- 减少动态效果（motion.md 第 4 节） ---------- */');
  L.push(
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    '    --wb-motion-duration-fast: 120ms;',
    '    --wb-motion-duration-base: 120ms;',
    '    --wb-motion-duration-page: 120ms;',
    '    --wb-motion-duration-slow: 120ms;',
    '    --wb-motion-reduced: 1;',
    '  }',
    '}',
    '',
  );
  return L.join('\n');
}

// ---------- Kotlin / Compose ----------
function kColor(v) {
  const raw = String(resolveValue(v)).trim();
  let r,
    g,
    b,
    a = 1;
  let m;
  if ((m = raw.match(/^#([0-9a-f]{6})$/i))) {
    [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16));
  } else if (
    (m = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i))
  ) {
    [r, g, b] = [m[1], m[2], m[3]].map(Number);
    a = m[4] === undefined ? 1 : Number(m[4]);
  } else throw new Error(`无法转换颜色：${raw}`);
  const hex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  return `Color(0x${hex(Math.round(a * 255))}${hex(r)}${hex(g)}${hex(b)})`;
}
const kDim = (v, unit) =>
  `${parseFloat(resolveValue(v))}.${unit}`.replace(/^(\d+)\.(dp|sp)$/, '$1.$2');
const kName = (path) => camelJoin(path.map((p) => (/^\d/.test(p) ? `s${p}` : p)));
const kConst = (path) => pascal(path.map((p) => String(p)).join('-'));

function buildKotlin(pkg) {
  const L = [];
  const fields = [];
  walk(tokens.theme[themeIds[0]].light.color, [], (p) => fields.push(p));
  const modeFields = [];
  walk(tokens.semantic.light.color, [], (p) => modeFields.push(p));
  L.push('// 由 scripts/build-tokens.mjs 从 docs/design/tokens.json 生成，请勿手改。');
  L.push(`// 令牌版本 ${tokens.meta.version}`);
  L.push(`package ${pkg}`, '');
  L.push('import androidx.compose.animation.core.CubicBezierEasing');
  L.push('import androidx.compose.runtime.Immutable');
  L.push('import androidx.compose.ui.graphics.Color');
  L.push('import androidx.compose.ui.text.font.FontWeight');
  L.push('import androidx.compose.ui.unit.dp');
  L.push('import androidx.compose.ui.unit.sp', '');

  L.push('/** 随主题 × 深浅模式变化的颜色（bg / text / border / brand / bubble 五组） */');
  L.push('@Immutable', 'data class WbThemeColors(');
  fields.forEach((p, i) => L.push(`    val ${kName(p)}: Color${i < fields.length - 1 ? ',' : ''}`));
  L.push(')', '');
  L.push('/** 只随深浅模式变化、两个主题共用的颜色 */');
  L.push('@Immutable', 'data class WbModeColors(');
  modeFields.forEach((p, i) =>
    L.push(`    val ${kName(p)}: Color${i < modeFields.length - 1 ? ',' : ''}`),
  );
  L.push(')', '');

  L.push('/** 主题标识。id 与网页 data-theme 相同 */');
  L.push('enum class WbThemeId(val id: String, val displayName: String) {');
  themeIds.forEach((t, i) =>
    L.push(
      `    ${pascal(t)}("${t}", "${tokens.meta.themes[t]?.name ?? t}")${i < themeIds.length - 1 ? ',' : ';'}`,
    ),
  );
  L.push(
    `    companion object { val Default = ${pascal(themeIds.find((t) => tokens.meta.themes[t]?.default) ?? themeIds[0])} }`,
  );
  L.push('}', '');

  L.push('object WbColorSets {');
  for (const t of themeIds)
    for (const m of modes) {
      L.push(`    val ${pascal(t)}${pascal(m)} = WbThemeColors(`);
      const vals = [];
      walk(tokens.theme[t][m].color, [], (p, tk) =>
        vals.push(`        ${kName(p)} = ${kColor(tk.$value)}`),
      );
      L.push(vals.join(',\n'), '    )');
    }
  for (const m of modes) {
    L.push(`    val Mode${pascal(m)} = WbModeColors(`);
    const vals = [];
    walk(tokens.semantic[m].color, [], (p, tk) =>
      vals.push(`        ${kName(p)} = ${kColor(tk.$value)}`),
    );
    L.push(vals.join(',\n'), '    )');
  }
  L.push('    fun theme(id: WbThemeId, dark: Boolean): WbThemeColors = when (id) {');
  themeIds.forEach((t) =>
    L.push(`        WbThemeId.${pascal(t)} -> if (dark) ${pascal(t)}Dark else ${pascal(t)}Light`),
  );
  L.push('    }');
  L.push('    fun mode(dark: Boolean): WbModeColors = if (dark) ModeDark else ModeLight');
  L.push('}', '');

  L.push('/** 应援色预设盘（default-avatar.md 第 3 节） */');
  L.push(
    'object WbSupportPalette {',
    '    data class Swatch(val name: String, val bg: Color, val on: Color)',
    '    val all = listOf(',
  );
  const sw = Object.entries(tokens.primitive.color.support).filter(([k]) => !k.startsWith('$'));
  sw.forEach(([, v], i) =>
    L.push(
      `        Swatch("${v.name}", ${kColor(v.bg.$value)}, ${kColor(v.on.$value)})${i < sw.length - 1 ? ',' : ''}`,
    ),
  );
  L.push('    )', '}', '');

  L.push('/** 分享图固定色 */', 'object WbShare {');
  walk(tokens.share, [], (p, t) => L.push(`    val ${kConst(p)} = ${kColor(t.$value)}`));
  L.push('}', '');

  L.push(
    '/** 字号（sp，已随系统字体缩放；应用内字体大小设置再乘 WbFontScale） */',
    'object WbFontSize {',
  );
  walk(tokens.typography.fontSize, [], (p, t) =>
    L.push(`    val ${kConst(p)} = ${kDim(t.$value, 'sp')}`),
  );
  L.push('}', 'object WbLineHeight {');
  walk(tokens.typography.lineHeight, [], (p, t) =>
    L.push(`    const val ${kConst(p)} = ${t.$value}f`),
  );
  L.push('}', 'object WbFontWeight {');
  walk(tokens.typography.fontWeight, [], (p, t) =>
    L.push(`    val ${kConst(p)} = FontWeight(${t.$value})`),
  );
  L.push(
    '}',
    'object WbFontScale {',
    '    val steps = listOf(0.9f, 1f, 1.1f, 1.2f, 1.35f)',
    '}',
    '',
  );

  L.push('object WbSpace {');
  walk(tokens.space, [], (p, t) => L.push(`    val S${p[0]} = ${kDim(t.$value, 'dp')}`));
  L.push('}', 'object WbRadius {');
  walk(tokens.radius, [], (p, t) => {
    if (t.$type === 'number') L.push(`    const val ${kConst(p)} = ${t.$value}f`);
    else L.push(`    val ${kConst(p)} = ${kDim(t.$value, 'dp')}`);
  });
  L.push('}', 'object WbSize {');
  walk(tokens.size, [], (p, t) => {
    if (t.$type === 'number') L.push(`    const val ${kConst(p)} = ${t.$value}f`);
    else L.push(`    val ${kConst(p)} = ${kDim(t.$value, 'dp')}`);
  });
  L.push('}', '');

  L.push(
    '/** 阴影用 elevation 近似（浮层专用） */',
    'object WbElevation {',
    '    val None = 0.dp',
    '    val Sm = 1.dp',
    '    val Md = 4.dp',
    '    val Lg = 8.dp',
    '}',
    '',
  );

  L.push('object WbMotion {');
  walk(tokens.motion.duration, [], (p, t) =>
    L.push(`    const val ${kConst(p)}Ms = ${parseInt(t.$value, 10)}`),
  );
  walk(tokens.motion.easing, [], (p, t) =>
    L.push(`    val ${kConst(p)} = CubicBezierEasing(${t.$value.map((n) => `${n}f`).join(', ')})`),
  );
  L.push('}', 'object WbOpacity {');
  walk(tokens.opacity, [], (p, t) => L.push(`    const val ${kConst(p)} = ${t.$value}f`));
  L.push('}', '');
  return L.join('\n');
}

// ---------- 输出 ----------
const cssOut = opt('--css');
const ktOut = opt('--kotlin');
const outputs = [];
if (cssOut) outputs.push({ path: cssOut, build: buildCss });
if (ktOut)
  outputs.push({
    path: ktOut,
    build: () => buildKotlin(opt('--package') ?? 'app.weiban.designsystem.tokens'),
  });

if (args.includes('--check')) {
  console.log('tokens.json 检查通过');
  // 换行符统一成 \n 再比较，避免 Windows 检出时的 CRLF 造成误报
  const normalize = (s) => s.replace(/\r\n/g, '\n');
  const stale = outputs.filter(({ path, build }) => {
    const file = resolve(path);
    return !existsSync(file) || normalize(readFileSync(file, 'utf8')) !== normalize(build());
  });
  for (const { path } of outputs) {
    console.log(stale.some((s) => s.path === path) ? '不是最新：' : '已是最新：', path);
  }
  if (stale.length > 0) {
    console.error(
      '生成物与 tokens.json 不一致：请运行 pnpm tokens（安卓文件用 --kotlin）重新生成后提交，不要手改生成物。',
    );
    process.exit(1);
  }
  process.exit(0);
}
if (outputs.length === 0) {
  console.error('请指定 --css <路径> 和 / 或 --kotlin <路径>');
  process.exit(1);
}
for (const { path, build } of outputs) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), build());
  console.log('已生成', path);
}
