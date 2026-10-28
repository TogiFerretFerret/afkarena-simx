# Babel to Rust execution contract

This compiler emits Rust execution code. JavaScript is the independent reference,
not an execution fallback. Unsupported syntax or runtime semantics must produce
an explicit diagnostic; they must never become a successful no-op.

## Ownership

| Area | Agent | Files |
| --- | --- | --- |
| Expressions and references | speed_compiler | expressions.mjs |
| Statements and control flow | speed_parallel | statements.mjs |
| Driver, lexical planning, integration | rust_integration_review | compile.mjs, tests |
| Values, coercion, operators | throughput_v8 | js-runtime/src/value.rs |
| Objects, descriptors, builtins, runtime | speed_heap | runtime.rs, heap.rs |
| Environments, functions, closures | rust_engine_driver | env.rs, closures.rs |

The parent owns workspace/build wiring and integration fixes after coordination.
Agents coordinate API changes directly and commit working increments frequently.

## Runtime interface

`Value` is Copy: Undefined, Null, Bool(bool), Number(f64), String(StringId),
Object(ObjectId), Function(FunctionId). IDs are stable usize newtypes. Strings
store UTF-16 code units, preserving lone surrogates. Number stays binary64.
BigInt/Symbol support must be implemented explicitly or rejected explicitly.

Generated/native function pointer:

```rust
fn(&mut Runtime, Value /* this */, &[Value] /* arguments */, EnvId /* captured */)
    -> JsResult<Value>
```

The generated function creates its own child environment. Closures retain their
parent environment by stable identity; mutable captures are not copied. Function
records distinguish strict functions and bound receiver/argument state.

Canonical calls (coordinate additions rather than inventing competing names):

- `string(&str) -> Value`, `intern_utf16`, `string_units`;
- `object() -> Value`, `array(&[Option<Value>]) -> Value` (None is a hole);
- `get(object, key: Value) -> JsResult<Value>`;
- `set(object, key, value, strict: bool) -> JsResult<Value>`;
- `delete(object, key, strict: bool) -> JsResult<Value>`;
- `define_data`, `define_accessor` with ordinary descriptor semantics;
- `call(callee, receiver, &[Value]) -> JsResult<Value>`, `construct`;
- `function(code, captured: EnvId, strict: bool) -> Value`;
- `child_env(parent) -> EnvId`, `declare(env, name, value)`;
- `lookup(env, name) -> JsResult<Value>`;
- `assign(env, name, value, strict) -> JsResult<Value>`;
- `typeof_name(env, name) -> JsResult<Value>` handles an unbound name;
- `binary(BinaryOp, left, right)`, `unary(UnaryOp, value)`;
- `truthy(Value) -> bool`, conversions and equality in value semantics.

`JsError::Throw(Value)` retains thrown identity. TypeError/ReferenceError/
RangeError variants may be materialized into ordinary error objects at a catch
boundary by `error_value`. Unsupported is an internal hard failure: source
try/catch must not swallow it and make an unsupported program look successful.

## Generator interface

Expressions export `emitExpression(node, ctx) -> temp identifier`, plus reference
helpers. Statements export `emitStatement(node, ctx)` and `emitStatements`.
The driver owns the context and nested function registry:

- `ctx.emit(line)`;
- `ctx.temp(rhs)` emits a fresh `let` and returns its identifier;
- `ctx.fresh(prefix)`;
- `ctx.env`, `ctx.thisValue`, `ctx.strict`;
- `ctx.expression(node)` delegates to expression lowering;
- `ctx.makeClosure(node)` registers nested code and emits closure creation.

Evaluate every effectful operand into a temporary in source order. In particular:
LHS object/key expressions and old value precede compound-assignment RHS; a method receiver
survives argument evaluation; short-circuit expressions return operand values;
postfix updates return the converted old Number; assignments perform their store
after RHS evaluation. Keep a property reference's raw key Value: do not eagerly
coerce an object key. In pinned Node, `o[k] = rhs()` coerces k after rhs, while
`o[k] += rhs()` coerces k on the read and again on the write. Capture references
without accidentally memoizing these observable conversions. Binding references
are resolved before the RHS. Do not use nested mutable Rust borrows to obscure order.

Hoist var and function declarations per function before execution. A var
statement without an initializer does not reset an existing parameter/binding.
Continue in a for loop executes its update expression. Try/finally must retain
and override pending return/throw/break/continue completions exactly; do not let
Rust `?` escape a source catch accidentally.

## Acceptance

First produce an executable generated source function, then expand coverage to
the supplied battle call graph. A compile-coverage manifest records unsupported
syntax with exact locations and reasons. Passing compilation is not semantic
qualification. Differential tests execute generated Rust against pinned jitless
source and compare ordered effects, exception identity/prefixes and f64 bits.
Keep real source failures and unsupported domains visible. Component throughput
does not count as full-battle throughput.
