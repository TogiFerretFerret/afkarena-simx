import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

// Source factory expressions are parsed independently. Only free identifiers can
// name source globals: parameter/local names, property keys, comments and strings
// are not dependencies. Static ed paths are retained including their parents.
export function sourceDependencies(source, globals, { statement = false } = {}) {
  const ast = parse(statement ? source : `(${source})`, { sourceType: 'script' });
  const dependencies = new Set();
  traverse(ast, {
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (!path.scope.hasBinding(name) && globals.has(name)) dependencies.add(name);
    },
    MemberExpression(path) {
      let node = path.node;
      const parts = [];
      while (node.type === 'MemberExpression') {
        if (!node.computed && node.property.type === 'Identifier') parts.unshift(node.property.name);
        else if (node.computed && node.property.type === 'StringLiteral') parts.unshift(node.property.value);
        else return;
        node = node.object;
      }
      if (node.type === 'Identifier' && node.name === 'ed' && !path.scope.hasBinding('ed')) {
        for (let i = 1; i <= parts.length; i++) dependencies.add(`ed.${parts.slice(0, i).join('.')}`);
      }
    },
  });
  return dependencies;
}

export function closeSourceSelection(records, initial) {
  const selected = new Set(initial), pending = [...initial], visited = new Set();
  const add = name => {
    if (!selected.has(name)) { selected.add(name); pending.push(name); }
    for (let p = name.lastIndexOf('.'); p > 0; p = name.lastIndexOf('.', p - 1)) {
      const parent = name.slice(0, p);
      if (!selected.has(parent)) { selected.add(parent); pending.push(parent); }
    }
  };
  for (const name of initial) add(name);
  for (const record of [...records.initializers, ...records.postInitializers, ...(records.functionDeclarations || [])]) {
    for (const name of sourceDependencies(record.source, records.globals, { statement: true })) add(name);
  }
  while (pending.length) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    visited.add(name);
    for (const record of records.definitions.get(name) || records.globals.get(name) || []) {
      for (const dependency of sourceDependencies(record.source, records.globals)) add(dependency);
    }
  }
  return selected;
}
