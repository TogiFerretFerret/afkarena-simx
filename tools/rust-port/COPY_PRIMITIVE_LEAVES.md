# Callback-free ordinary copy leaves

The existing exact-source `ed.copyObj` lowering now admits ordinary flat objects containing strings, booleans, null, undefined, functions and finite numbers. The pinned source recurses only for truthy `typeof n === "object"`; functions retain identity and are not invoked. UTF16 values retain their exact StringId contents. Arrays retain their previous domain, recursive objects and nonfinite numbers retain source fallback.

Every previous intrinsic, lexical Object, constructor, prototype, descriptor, inherited-write and free-object-slot guard remains. All checks precede destination allocation; property storage and index cloning preserve fresh destination identity and source key order. This expands an existing compiler helper; it does not add an AST pass.

Validation:76 specialization OFF/ON Node observations pass,119 native library and26 integration tests pass. The new test proves copied giant UTF16 strings (including lone surrogates), function identity and captured environment values survive23 actual source-pinned battle GC safepoints, while negative-zero raw bits remain unchanged. Source cases cover mixed leaves, function invocation ordering, getter mutation and nested-object fallback.

Performance qualification is pending independent two-library original-component and large-input measurements. Do not claim a battle throughput gain from the domain proof. Proof artifacts are under `benchmarks/validation/copy-primitive-leaves/`.
