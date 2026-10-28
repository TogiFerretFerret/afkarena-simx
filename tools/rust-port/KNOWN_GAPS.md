# Native execution fidelity gaps

These are limits of the generated Rust execution core, not accepted changes to
the game's behavior. AST coverage and passing component gates do not establish
whole-battle fidelity. Preserve failing evidence until the corresponding behavior
is implemented and independently compared with the pinned Node/V8 reference.

## Array constructor and inherited indexed setters

Run `node tools/rust-port/check-array-constructor.mjs`. The checker exits with
status 1 while this gap remains and writes
`benchmarks/validation/rust-generated-array-constructor.json`, with source hashes,
the exact first difference and an archived observation. `expectedFailure: true`
labels a known failure; it does not turn it into a passing test.

```js
var count = 0;
Object.defineProperty(Array.prototype, "0", {
  set: function () { count++; }, configurable: true
});
var a = Array(7, 8);
delete Array.prototype[0];
count + ":" + Object.hasOwn(a, "0") + ":" + a[0] + ":" + a.length;
```

The source reference returns `0:true:7:2`; the recorded Rust result is
`1:false:undefined:2`. The Rust constructor currently writes elements through
`Set`, allowing the inherited setter to consume index 0, instead
of creating the required own data property. This is not evidence that the fixed
battle fixture installs such a setter. Array literals already create own data
properties. Code inspection also identifies `filter` output and the removed-item
array from `splice` as using `Set`; those paths need their own source comparisons
before claiming they are fixed.

## V8 numeric-array storage and signaling NaNs

The pinned reference (`node --jitless`) changes the stored bits when a signaling
NaN enters a numeric dense array. Object properties and mixed arrays can retain
the original bits. A single global NaN normalization would therefore be wrong.

```js
var d = new DataView(new ArrayBuffer(8));
d.setUint32(0, 0x7ff00000);
d.setUint32(4, 1);
var n = d.getFloat64(0);
var a = [n], o = {n: n}, m = [null, n], p = [];
p.push(n);
function bits(v) {
  d.setFloat64(0, v);
  return d.getUint32(0).toString(16).padStart(8, "0") +
         d.getUint32(4).toString(16).padStart(8, "0");
}
[bits(n), bits(a[0]), bits(o.n), bits(m[1]), bits(p[0])].join("|");
```

The source result is:

```text
7ff0000000000001|7ff8000000000001|7ff0000000000001|7ff0000000000001|7ff8000000000001
```

The Rust heap currently stores `Value::Number` without V8 array element-kind
transitions. A direct native `Runtime::array` test retains
`7ff0000000000001` at index 0. Implementing the storage transitions requires
tracking the relevant representation history, including mixed arrays; changing
all NaNs on every write would corrupt already-correct cases. No current evidence
shows the fixed battle fixture reaches this signaling-NaN case. JSON tables
cannot directly encode NaN, so this reproduction is not itself a battle failure.

## Explicit unsupported operations

Some gaps stop execution with an internal `Unsupported` error instead of silently
returning a guessed value. One is integer remainder with a positive-zero divisor:
pinned V8's tagged-number representation can choose different NaN bits, and a
plain `f64` does not retain that provenance. An audit of the seven frozen source
units found 115 remainder sites and no literal-zero divisor. Variable divisors
have nonzero defaults, source guards or fixed configuration in the inspected
paths; this does not prove the domain unreachable for every battle/input.

Symbols/custom Symbol iterators, dynamic source compilation and V8 stack
rendering also remain outside the supported runtime domain. This file records
specific findings, not a complete ECMAScript conformance inventory.
