/**
 * 各条边界规则共用的小工具：判断「这个文件属于服务器的哪个模块」、收集 import 来源等。
 * 只根据文件路径字符串判断，不读磁盘，所以测试时可以用虚构的文件路径。
 */
import path from 'node:path';
import { LAYER_RANK, SERVER_MODULES } from '../architecture.js';

export const STANDARDS_DOC = 'docs/architecture/engineering-standards.md 第 3 节';

/** 把 Windows 路径统一成正斜杠。 */
export function toPosix(filename) {
  return filename.replaceAll('\\', '/');
}

const SERVER_SRC = /^(.*\/apps\/server\/src)\/(.*)$/;
const COMPOSITION_FILES = /^(main|app\.module)\.[cm]?[jt]sx?$/;
const INDEX_FILE = /^index(\.[cm]?[jt]sx?)?$/;

/**
 * 判断一个文件（或 import 解析出的路径）在服务器代码中的位置。
 * @returns {{ kind: 'module', module: string, inner: string }
 *   | { kind: 'platform' | 'composition' | 'server-other' }
 *   | { kind: 'outside' }}
 * inner：模块目录内的相对路径（'' 表示模块目录本身）。
 */
export function locate(filename) {
  const match = SERVER_SRC.exec(toPosix(filename));
  if (!match) return { kind: 'outside' };
  const rest = match[2] ?? '';
  const segments = rest.split('/');
  if (segments[0] === 'modules' && segments[1]) {
    return { kind: 'module', module: segments[1], inner: segments.slice(2).join('/') };
  }
  if (segments[0] === 'platform') return { kind: 'platform' };
  if (segments.length === 1 && COMPOSITION_FILES.test(rest)) return { kind: 'composition' };
  return { kind: 'server-other' };
}

/** 模块目录内的路径是否就是公开出口 index.ts（R1）。 */
export function isModuleEntry(inner) {
  return inner === '' || INDEX_FILE.test(inner);
}

/** 位置对应的层级数字（R2）。未知的位置返回 null，不参与层级判断。 */
export function rankOf(location) {
  if (location.kind === 'platform') return LAYER_RANK.platform;
  if (location.kind === 'composition') return LAYER_RANK.composition;
  if (location.kind === 'module') {
    const info = SERVER_MODULES[location.module];
    return info ? LAYER_RANK[info.layer] : null;
  }
  return null;
}

export function isTestFile(filename) {
  const p = toPosix(filename);
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /\/(test|tests|__tests__)\//.test(p);
}

/** 相对路径的 import 解析成（正斜杠的）完整路径；非相对路径返回 null。 */
export function resolveRelative(filename, source) {
  if (!source.startsWith('./') && !source.startsWith('../') && source !== '.' && source !== '..') {
    return null;
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(toPosix(filename)), source));
}

/**
 * 生成访问器：对文件里每一个「模块来源字符串」调用 callback(sourceText, node)。
 * 覆盖 import / export ... from / 动态 import() / require() / import x = require()。
 */
export function importSourceVisitors(callback) {
  const check = (node) => {
    if (node && node.type === 'Literal' && typeof node.value === 'string')
      callback(node.value, node);
  };
  return {
    ImportDeclaration: (node) => check(node.source),
    ExportNamedDeclaration: (node) => check(node.source),
    ExportAllDeclaration: (node) => check(node.source),
    ImportExpression: (node) => check(node.source),
    TSExternalModuleReference: (node) => check(node.expression),
    CallExpression: (node) => {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
        check(node.arguments[0]);
      }
    },
  };
}

/** 包名是否命中名单。名单里 'foo/*' 表示 foo 下所有子路径 / 作用域下所有包。 */
export function matchesPackage(source, patterns) {
  return patterns.some((pattern) => {
    if (pattern.endsWith('/*')) return source.startsWith(pattern.slice(0, -1));
    return source === pattern || source.startsWith(`${pattern}/`);
  });
}
