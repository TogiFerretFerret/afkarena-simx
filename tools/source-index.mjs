import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Syntactic names are evidence for resolution, never resolved call targets.
export function staticName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return String(node.value);
  if (node.type === 'MemberExpression') {
    const object = staticName(node.object);
    const key = node.computed
      ? (['StringLiteral', 'NumericLiteral'].includes(node.property.type) ? staticName(node.property) : null)
      : staticName(node.property);
    return object !== null && key !== null ? `${object}.${key}` : null;
  }
  return null;
}

function propertyKey(node) {
  return node.computed
    ? (['StringLiteral', 'NumericLiteral'].includes(node.key.type) ? staticName(node.key) : null)
    : staticName(node.key);
}

function objectOwner(path) {
  const parent = path.parentPath;
  if (parent.isAssignmentExpression() && parent.node.right === path.node) return staticName(parent.node.left);
  if (parent.isVariableDeclarator()) return staticName(parent.node.id);
  if (parent.isObjectProperty()) {
    const owner = objectOwner(parent.parentPath);
    const key = propertyKey(parent.node);
    return owner !== null && key !== null ? `${owner}.${key}` : null;
  }
  if (parent.isCallExpression() && parent.node.arguments[0] === path.node && staticName(parent.node.callee)?.endsWith('.extend')) {
    const assignment = parent.parentPath;
    if (assignment.isAssignmentExpression()) return staticName(assignment.node.left);
  }
  return null;
}

function functionName(path) {
  const parent = path.parentPath;
  if (parent.isAssignmentExpression()) return staticName(parent.node.left);
  if (parent.isVariableDeclarator()) return staticName(parent.node.id);
  if (path.isFunctionDeclaration()) return path.node.id?.name ?? null;
  if (parent.isObjectProperty() || path.isObjectMethod()) {
    const property = path.isObjectMethod() ? path : parent;
    const key = propertyKey(property.node);
    const owner = objectOwner(property.parentPath);
    return owner !== null && key !== null ? `${owner}.${key}` : key;
  }
  return null;
}

export function indexSource(source, file) {
  const ast = parse(source, { sourceType: 'script', errorRecovery: false });
  const functions = [];
  const calls = [];
  const classes = [];
  const stack = [];
  traverse(ast, {
    Function: {
      enter(path) {
        const record = {
          id: `${file}:${path.node.start}`,
          name: functionName(path),
          start: path.node.start, end: path.node.end,
          line: path.node.loc.start.line, column: path.node.loc.start.column,
          parent: stack.at(-1)?.id ?? null,
          params: path.node.params.map(p => p.type === 'Identifier' ? p.name : null),
        };
        functions.push(record);
        stack.push(record);
      },
      exit() { stack.pop(); },
    },
    'CallExpression|NewExpression'(path) {
      const callee = staticName(path.node.callee);
      calls.push({
        owner: stack.at(-1)?.id ?? null,
        start: path.node.start, end: path.node.end,
        callee, kind: path.isNewExpression() ? 'construct' : 'call',
        resolution: 'unresolved',
      });
      if (callee?.endsWith('.extend') && path.parentPath.isAssignmentExpression()) {
        classes.push({
          name: staticName(path.parentPath.node.left),
          base: callee.slice(0, -'.extend'.length),
          start: path.node.start,
        });
      }
    },
  });
  return { file, functions, calls, classCandidates: classes };
}

async function jsFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await jsFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) paths.push(path);
  }
  return paths.sort();
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const files = [];
  for (const path of await jsFiles(resolve(root, 'src'))) {
    files.push(indexSource(await readFile(path, 'utf8'), relative(root, path)));
  }
  const result = { version: 1, analysis: 'syntactic_index_not_reachability', offsetUnit: 'utf16_code_units', files };
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node tools/source-index.mjs OUTPUT.json');
  await writeFile(output, JSON.stringify(result));
  console.log(JSON.stringify({ files: files.length,
    functions: files.reduce((n, f) => n + f.functions.length, 0),
    calls: files.reduce((n, f) => n + f.calls.length, 0), output }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
