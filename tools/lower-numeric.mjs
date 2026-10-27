import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { staticName } from './source-index.mjs';

// Deliberately small lowering domain. Unknown constructs fail closed.
export function lowerFunction(fn, paramTypes) {
  if (fn.async || fn.generator || fn.params.length !== paramTypes.length) throw new Error('Unsupported function signature');
  const bindings = new Map();
  const params = fn.params.map((p, i) => {
    if (p.type !== 'Identifier' || !['vec2', 'f64'].includes(paramTypes[i])) throw new Error('Unsupported parameter');
    const value = { id: `arg${i}`, type: paramTypes[i] };
    if (bindings.has(p.name)) throw new Error('Duplicate parameter');
    bindings.set(p.name, value);
    return value;
  });
  const operations = [];
  function emit(op, fields, type = 'f64') {
    const value = { id: `v${operations.length}`, type };
    operations.push({ ...value, op, ...fields });
    return value;
  }
  function expression(node) {
    if (node.type === 'Identifier') {
      const value = bindings.get(node.name);
      if (!value) throw new Error(`Unbound identifier: ${node.name}`);
      return value;
    }
    if (node.type === 'NumericLiteral') return emit('constant', { value: node.value });
    if (node.type === 'MemberExpression') {
      const object = expression(node.object);
      if (object.type !== 'vec2' || !node.computed || node.property.type !== 'NumericLiteral' || ![0, 1].includes(node.property.value)) throw new Error('Unsupported property read');
      return emit('load', { object: object.id, index: node.property.value });
    }
    if (node.type === 'BinaryExpression') {
      if (!['+', '-', '*', '/'].includes(node.operator)) throw new Error(`Unsupported operator: ${node.operator}`);
      const left = expression(node.left);
      const right = expression(node.right);
      if (left.type !== 'f64' || right.type !== 'f64') throw new Error('Numeric operand required');
      return emit('binary', { operator: node.operator, left: left.id, right: right.id });
    }
    if (node.type === 'ArrayExpression' && node.elements.length === 2) {
      const elements = node.elements.map(element => expression(element));
      if (elements.some(e => e.type !== 'f64')) throw new Error('Numeric array elements required');
      return emit('vec2', { elements: elements.map(e => e.id) }, 'vec2');
    }
    throw new Error(`Unsupported expression: ${node.type}`);
  }
  let result;
  for (const statement of fn.body.body) {
    if (result) throw new Error('Unreachable statements require explicit handling');
    if (statement.type === 'VariableDeclaration' && statement.kind === 'var') {
      for (const d of statement.declarations) {
        if (d.id.type !== 'Identifier' || !d.init || bindings.has(d.id.name)) throw new Error('Unsupported local binding');
        bindings.set(d.id.name, expression(d.init));
      }
    } else if (statement.type === 'ReturnStatement' && statement.argument) result = expression(statement.argument);
    else throw new Error(`Unsupported statement: ${statement.type}`);
  }
  if (!result) throw new Error('Missing return');
  return { params, operations, result };
}

export function emitRust(name, ir) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Invalid Rust function name');
  const type = t => t === 'vec2' ? '[f64; 2]' : 'f64';
  const lines = [`#[inline]`, `pub fn ${name}(${ir.params.map(p => `${p.id}: ${type(p.type)}`).join(', ')}) -> ${type(ir.result.type)} {`];
  for (const op of ir.operations) {
    let rhs;
    if (op.op === 'constant') rhs = `${JSON.stringify(op.value)}_f64`;
    else if (op.op === 'load') rhs = `${op.object}[${op.index}]`;
    else if (op.op === 'binary') {
      const name = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' }[op.operator];
      if (!name) throw new Error('Unknown binary arithmetic operation');
      rhs = `crate::js_math::${name}(${op.left}, ${op.right})`;
    }
    else if (op.op === 'vec2') rhs = `[${op.elements.join(', ')}]`;
    else throw new Error('Unknown IR operation');
    lines.push(`    let ${op.id}: ${type(op.type)} = ${rhs};`);
  }
  lines.push(`    ${ir.result.id}`, '}');
  return lines.join('\n');
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(await readFile(resolve(root, 'config/numeric-kernels.json'), 'utf8'));
  const source = await readFile(resolve(root, config.source), 'utf8');
  const definitions = new Map();
  traverse(parse(source, { sourceType: 'script' }), {
    AssignmentExpression(path) {
      const name = staticName(path.node.left);
      if (!config.kernels.some(k => k.sourceName === name)) return;
      if (path.node.operator !== '=') throw new Error(`Unsupported definition assignment: ${name}`);
      // Repeated byte-identical function bodies preserve the kernel calculation;
      // differing definitions require explicit dispatch/initialization analysis.
      const previous = definitions.get(name) ?? [];
      const fn = path.node.right;
      if (previous.some(p => source.slice(p.start, p.end) !== source.slice(fn.start, fn.end))) {
        throw new Error(`Conflicting definitions: ${name}`);
      }
      previous.push(fn);
      definitions.set(name, previous);
    },
  });
  const kernels = config.kernels.map(k => {
    const matches = definitions.get(k.sourceName) ?? [];
    const fn = matches.at(-1);
    if (!fn || fn.type !== 'FunctionExpression') throw new Error(`Missing function: ${k.sourceName}`);
    return { ...k, start: fn.start, end: fn.end,
      sourceSha256: createHash('sha256').update(source.slice(fn.start, fn.end)).digest('hex'),
      definitions: matches.map(node => ({ start: node.start, end: node.end,
        sha256: createHash('sha256').update(source.slice(node.start, node.end)).digest('hex') })),
      ir: lowerFunction(fn, k.params) };
  });
  const rust = '// Generated by tools/lower-numeric.mjs; do not edit.\n// Valid only under config/numeric-kernels.json domain assumptions.\n// Arithmetic follows config/js-arithmetic-runtime.json; V8 array storage feedback is not modeled.\n\n' + kernels.map(k => emitRust(k.rustName, k.ir)).join('\n\n') + '\n';
  const files = [
    ['crates/battle-core/src/numeric.rs', rust],
    ['config/numeric-kernels.ir.json', JSON.stringify({ version: 1, source: config.source, domain: config.domain, kernels }, null, 2) + '\n'],
  ];
  for (const [path, content] of files) {
    if (process.argv.includes('--check')) {
      if (await readFile(resolve(root, path), 'utf8') !== content) throw new Error(`Stale generated file: ${path}`);
    } else await writeFile(resolve(root, path), content);
  }
  console.log(`${process.argv.includes('--check') ? 'Checked' : 'Generated'} ${kernels.length} numeric kernels`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
