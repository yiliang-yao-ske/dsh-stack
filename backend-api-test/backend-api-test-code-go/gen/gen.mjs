#!/usr/bin/env node
/**
 * Deterministic case generator: case YAML -> Go case table.
 *
 * No third-party dependency. It understands a strict subset of YAML:
 * block maps, block sequences, inline maps/arrays, quoted and plain scalars.
 * Anything outside that subset is an error, never a guess.
 *
 *   node gen/gen.mjs --out-dir <dir> [--template <file>] <yml...>
 *
 * The output contains data only: no functions, no control flow, no HTTP.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIELD_TYPES = new Set(['string', 'int64', 'bool', 'string_array']);
const CASE_KEYS = new Set(['id', 'title', 'as', 'method', 'path', 'query', 'body', 'expect', 'kind', 'baseline', 'verify_tenant']);
const EXPECT_KEYS = new Set([
  'status', 'code', 'message_contains', 'message_any', 'message_non_empty', 'result_absent',
  'required', 'types', 'fields', 'headers',
]);
const FIELD_KEYS = new Set([
  'type', 'equals', 'equals_ref', 'prefix', 'contains', 'contains_all',
  'equals_set', 'non_empty', 'absent', 'allow_null', 'gt', 'token_join', 'approx_days',
]);
const HEADER_KEYS = new Set(['name', 'equals', 'contains']);
const IDENTITIES = new Set(['tenant_admin', 'dept_admin', 'anonymous']);
const BASELINES = new Set(['create']);

function fail(message) {
  const error = new Error(message);
  error.isConfigError = true;
  throw error;
}

function parseArgs(argv) {
  const out = { files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out-dir') out.outDir = argv[++index];
    else if (token === '--template') out.template = argv[++index];
    else if (!token.startsWith('--')) out.files.push(token);
    else fail(`未知参数: ${token}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Minimal YAML subset
// ---------------------------------------------------------------------------

function parseYaml(text, file) {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    if (raw.trimStart().startsWith('#')) return;
    const indent = raw.length - raw.trimStart().length;
    if (/[^\S ]/.test(raw.slice(0, indent))) fail(`${file}:${index + 1}: 缩进只能用空格`);
    lines.push({ indent, text: raw.trim(), line: index + 1 });
  });

  let pos = 0;
  const result = parseBlock(0);
  if (pos !== lines.length) fail(`${file}:${lines[pos].line}: 无法解析的内容`);
  return result;

  function parseBlock(indent) {
    if (pos >= lines.length) return null;
    const line = lines[pos];
    if (line.indent < indent) return null;
    return line.text.startsWith('- ') ? parseSequence(line.indent) : parseMapping(line.indent);
  }

  function parseSequence(indent) {
    const out = [];
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.indent !== indent || !line.text.startsWith('- ')) break;
      const rest = line.text.slice(2).trim();
      pos += 1;
      if (!rest) {
        out.push(parseBlock(indent + 1));
        continue;
      }
      if (splitKey(rest)) {
        const item = {};
        assignEntry(item, rest, indent + 2, file);
        while (pos < lines.length && lines[pos].indent === indent + 2) {
          const extra = lines[pos];
          pos += 1;
          assignEntry(item, extra.text, indent + 2, file);
        }
        out.push(item);
      } else {
        out.push(parseScalar(rest, `${file}:${line.line}`));
      }
    }
    return out;
  }

  function parseMapping(indent) {
    const out = {};
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.indent !== indent || line.text.startsWith('- ')) break;
      pos += 1;
      assignEntry(out, line.text, indent, file);
    }
    return out;
  }

  function assignEntry(target, text, indent, source) {
    const split = splitKey(text);
    if (!split) fail(`${source}:${lines[pos - 1].line}: 期望 "key: value"`);
    if (split.value !== '') {
      target[split.key] = parseScalar(split.value, `${source}:${lines[pos - 1].line}`);
      return;
    }
    const next = lines[pos];
    target[split.key] = next && next.indent > indent ? parseBlock(next.indent) : null;
  }
}

function splitKey(text) {
  let depth = 0;
  let quote = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{' || char === '[') { depth += 1; continue; }
    if (char === '}' || char === ']') { depth -= 1; continue; }
    if (char === ':' && depth === 0 && (index + 1 === text.length || text[index + 1] === ' ')) {
      return { key: text.slice(0, index).trim(), value: text.slice(index + 1).trim() };
    }
  }
  return null;
}

function parseScalar(raw, where) {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith('{')) return parseInlineMap(text, where);
  if (text.startsWith('[')) return parseInlineList(text, where);
  if (text.startsWith('"')) {
    try { return JSON.parse(text); } catch { fail(`${where}: 非法双引号字符串 ${text}`); }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'")) fail(`${where}: 非法单引号字符串 ${text}`);
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return Number.parseFloat(text);
  return text;
}

function parseInlineList(text, where) {
  if (!text.endsWith(']')) fail(`${where}: 未闭合的数组 ${text}`);
  const body = text.slice(1, -1).trim();
  if (!body) return [];
  return splitTopLevel(body, where).map((item) => parseScalar(item, where));
}

function parseInlineMap(text, where) {
  if (!text.endsWith('}')) fail(`${where}: 未闭合的对象 ${text}`);
  const body = text.slice(1, -1).trim();
  const out = {};
  if (!body) return out;
  for (const entry of splitTopLevel(body, where)) {
    const split = splitKey(entry);
    if (!split) fail(`${where}: 内联对象项缺少冒号: ${entry}`);
    out[split.key] = parseScalar(split.value, where);
  }
  return out;
}

function splitTopLevel(body, where) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote) fail(`${where}: 未闭合的引号`);
  const tail = body.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function checkKeys(object, allowed, where) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(`${where}: 未知键 "${key}"`);
  }
}

function normalizeCase(raw, context) {
  checkKeys(raw, CASE_KEYS, `${context.source}: case`);
  const id = raw.id;
  if (!id) fail(`${context.source}: case 缺少 id`);
  const where = `${context.source}: ${id}`;
  const as = raw.as;
  if (!IDENTITIES.has(as)) fail(`${where}: as 必须是 tenant_admin/dept_admin/anonymous，实际 "${as}"`);
  const expect = raw.expect;
  if (!expect) fail(`${where}: 缺少 expect`);
  checkKeys(expect, EXPECT_KEYS, where);

  const baseline = raw.baseline ?? '';
  if (baseline !== '' && !BASELINES.has(baseline)) {
    fail(`${where}: baseline 只能是 ${[...BASELINES].join('/')}，实际 "${baseline}"`);
  }
  if (raw.verify_tenant !== undefined && typeof raw.verify_tenant !== 'boolean') {
    fail(`${where}: verify_tenant 必须是 true/false`);
  }

  // A negative case must say something about the error it expects. Checking
  // only "code != 0 and message is non-empty" lets any validation error pass
  // every case; require a stable substring unless the case explicitly opts
  // out with message_any (e.g. the contract-wide envelope test).
  const code = expect.code ?? 0;
  const messageContains = typeof expect.message_contains === 'string' ? expect.message_contains.trim() : '';
  if (code !== 0 && !messageContains && expect.message_any !== true) {
    fail(`${where}: code != 0 的 case 必须提供 message_contains（稳定子串），或显式 message_any: true`);
  }
  if (expect.message_any !== undefined && typeof expect.message_any !== 'boolean') {
    fail(`${where}: message_any 必须是 true/false`);
  }

  const fields = Object.entries(expect.fields || {}).map(([path, spec]) => {
    checkKeys(spec, FIELD_KEYS, `${where}: fields.${path}`);
    if (!spec.absent && !FIELD_TYPES.has(spec.type)) {
      fail(`${where}: fields.${path}.type 必须是 ${[...FIELD_TYPES].join('/')}，实际 "${spec.type}"`);
    }
    return { path, ...spec };
  });

  const headers = (expect.headers || []).map((header, index) => {
    checkKeys(header, HEADER_KEYS, `${where}: headers[${index}]`);
    if (!header.name) fail(`${where}: headers[${index}].name 缺失`);
    return { name: header.name, equals: header.equals ?? '', contains: header.contains ?? '' };
  });

  for (const [path, type] of Object.entries(expect.types || {})) {
    if (!FIELD_TYPES.has(type)) fail(`${where}: types.${path} 不受支持 "${type}"`);
  }

  return {
    kind: raw.kind || context.kind,
    id,
    title: raw.title ?? '',
    as,
    method: raw.method || context.endpoint.method,
    path: raw.path || context.endpoint.path,
    query: raw.query || {},
    body: raw.body ?? null,
    baseline,
    wantStatus: expect.status ?? 200,
    wantCode: code,
    checkCode: Object.prototype.hasOwnProperty.call(expect, 'code'),
    messageContains,
    messageNonEmpty: Boolean(expect.message_non_empty),
    resultAbsent: Boolean(expect.result_absent),
    required: expect.required || [],
    types: expect.types || {},
    fields,
    headers,
    verifyTenant: raw.verify_tenant === true,
  };
}

// ---------------------------------------------------------------------------
// Go emission
// ---------------------------------------------------------------------------

function goString(value) {
  return JSON.stringify(String(value));
}

function goValue(value) {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string') return goString(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[]any{${value.map(goValue).join(', ')}}`;
  const keys = Object.keys(value).sort();
  return `map[string]any{${keys.map((key) => `${goString(key)}: ${goValue(value[key])}`).join(', ')}}`;
}

function stringMap(values) {
  const keys = Object.keys(values).sort();
  if (!keys.length) return 'nil';
  return `map[string]string{${keys.map((key) => `${goString(key)}: ${goString(values[key])}`).join(', ')}}`;
}

function stringSlice(values) {
  return values && values.length ? `[]string{${values.map(goString).join(', ')}}` : null;
}

function fieldLiteral(field) {
  const parts = [`Path: ${goString(field.path)}`, `Type: ${goString(field.type ?? '')}`];
  if (field.equals !== undefined) parts.push(`Equals: strptr(${goString(field.equals)})`);
  if (field.equals_ref) parts.push(`EqualsRef: ${goString(field.equals_ref)}`);
  if (field.prefix) parts.push(`Prefix: ${goString(field.prefix)}`);
  if (field.contains) parts.push(`Contains: ${goString(field.contains)}`);
  const all = stringSlice(field.contains_all);
  if (all) parts.push(`ContainsAll: ${all}`);
  const set = stringSlice(field.equals_set);
  if (set) parts.push(`EqualsSet: ${set}`);
  if (field.non_empty) parts.push('NonEmpty: true');
  if (field.absent) parts.push('Absent: true');
  if (field.allow_null) parts.push('AllowNull: true');
  if (field.gt !== undefined) parts.push(`GT: f64ptr(${field.gt})`);
  if (field.token_join) parts.push('TokenJoin: true');
  if (field.approx_days !== undefined) parts.push(`ApproxDays: intptr(${field.approx_days})`);
  return `{${parts.join(', ')}}`;
}

function caseLiteral(testCase) {
  const headers = testCase.headers.length
    ? `[]headerExpect{${testCase.headers.map((header) => `{Name: ${goString(header.name)}, Equals: ${goString(header.equals)}, Contains: ${goString(header.contains)}}`).join(', ')}}`
    : 'nil';
  const fields = testCase.fields.length
    ? `[]fieldExpect{\n\t\t\t${testCase.fields.map(fieldLiteral).join(',\n\t\t\t')},\n\t\t}`
    : 'nil';
  return `	{
		Kind: ${goString(testCase.kind)},
		ID: ${goString(testCase.id)}, Title: ${goString(testCase.title)}, As: ${goString(testCase.as)},
		Method: ${goString(testCase.method)}, Path: ${goString(testCase.path)},
		Query: ${stringMap(testCase.query)}, Body: ${goValue(testCase.body)},
		Baseline: ${goString(testCase.baseline)},
		WantStatus: ${testCase.wantStatus}, WantCode: ${testCase.wantCode}, CheckCode: ${testCase.checkCode},
		MessageContains: ${goString(testCase.messageContains)}, MessageNonEmpty: ${testCase.messageNonEmpty},
		ResultAbsent: ${testCase.resultAbsent},
		Required: ${stringSlice(testCase.required) || 'nil'}, Types: ${stringMap(testCase.types)},
		Fields: ${fields},
		Headers: ${headers},
		VerifyTenant: ${testCase.verifyTenant},
	},`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function goPackage(slug) {
  const name = slug.replace(/-/g, '');
  if (/^[a-z][a-z0-9]*$/.test(name)) return name;
  return `suite${name.replace(/[^a-z0-9]/g, '')}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.files.length || !args.outDir) {
    fail('用法: gen.mjs --out-dir <dir> [--template <file>] <yml...>');
  }
  const templatePath = args.template || resolve(dirname(fileURLToPath(import.meta.url)), '../template/suite.go.tmpl');
  const template = readFileSync(templatePath, 'utf8');
  if (!template.includes('@@PACKAGE@@') || !template.includes('@@CASES@@')) {
    fail(`${templatePath}: 模板缺少 @@PACKAGE@@ 或 @@CASES@@`);
  }

  const used = new Set();
  const results = [];
  for (const name of args.files) {
    const file = resolve(name);
    const document = parseYaml(readFileSync(file, 'utf8'), file);
    checkKeys(document, new Set(['schema', 'scenario', 'kind', 'endpoint', 'cases']), file);
    if (!document.endpoint || !document.endpoint.method || !document.endpoint.path) {
      fail(`${file}: endpoint.method 与 endpoint.path 必填`);
    }
    if (!Array.isArray(document.cases) || document.cases.length === 0) fail(`${file}: cases 为空`);
    const slug = String(document.scenario || basename(file).replace(/\.ya?ml$/i, ''));
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      fail(`${file}: scenario "${slug}" 只能由小写字母、数字、连字符组成`);
    }
    if (used.has(slug)) fail(`${file}: scenario 重复 "${slug}"`);
    used.add(slug);

    const cases = document.cases.map((raw) => normalizeCase(raw, {
      source: basename(file),
      kind: document.kind || 'param',
      endpoint: document.endpoint,
    }));
    const ids = new Set();
    for (const testCase of cases) {
      if (ids.has(testCase.id)) fail(`${file}: case id 重复 "${testCase.id}"`);
      ids.add(testCase.id);
    }

    const body = cases.map(caseLiteral).join(String.fromCharCode(10));
    const output = template.split('@@PACKAGE@@').join(goPackage(slug)).split('@@CASES@@').join(body);
    const outPath = resolve(args.outDir, slug, `${slug}_test.go`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, output, 'utf8');
    results.push(`${slug}: ${cases.length} cases -> ${outPath}`);
  }
  console.log(results.join(String.fromCharCode(10)));
}

try {
  main();
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  console.error(`gen: ${message}`);
  process.exit(1);
}
