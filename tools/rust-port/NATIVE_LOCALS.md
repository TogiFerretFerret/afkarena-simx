# Native Rust local variables

`nativeLocalBindings` promotes eligible function-scoped `var` bindings from
persistent runtime environment cells to `let mut Value` variables in generated
Rust. It defaults to true; false retains the environment-cell baseline.

Promotion excludes parameters, `arguments`, named-function bindings, declared
functions, program/global bindings, helper-split functions, direct eval/with,
possible closure captures and lexical/catch shadowing. A matching identifier in a
nested function conservatively counts as a possible capture, including property
or declaration names that could be proven unrelated with further analysis.
Remaining references also pass the existing local-binding eligibility check.

Each promoted variable starts as `Undefined` at function entry. Reads snapshot
its copied `Value`; assignments and updates store the same value as the cell
path. `typeof` and sloppy `delete` retain their binding behavior. Statement
closures borrow these Rust locals, so catch/finally and loop completions preserve
the source order. Parameters and captured variables keep their environment cells
and mapped-arguments behavior.

The current arena retains all heap IDs and has no tracing collector. A future
collector must include live generated Rust local Values in its root set; marking
only environment cells would miss those live references.

Validation commands:

```sh
node tools/rust-port/tests/native-locals.test.mjs
node tools/rust-port/check-native-locals.mjs
node tools/rust-port/check-control-flow.mjs
node tools/rust-port/check-closures.mjs
node tools/rust-port/tests/expressions.mjs
node --jitless tools/rust-port/benchmark-native-locals.mjs --updates 1000
```

The focused gate compares both promotion settings with source JS. The original
Unit.update fixture compares ordered callback events and selected raw-bit state
before reporting timing. The benchmark enables promotion across the entire
fixture, including observer helpers; its rates are updates/second, not complete
battles/second. The first three-trial comparison recorded 8,215 versus 8,943
updates/second (1.089x), with 40 original Unit.update locals promoted and all
15,024 observed events matching per trial. Concurrent build activity makes that
timing provisional. Full-battle parity and throughput remain separate gates.
