/* Exact-call observer for the pinned Cocos allocators. No counter is queried,
 * seeded, reset or advanced by installation/snapshotting. The capability stays
 * outside source globals; wrappers are shared byte-for-byte with native AOT.
 */
(function (global) {
    global.installClassManagerObserver = function (proof) {
        var getDescriptor = Object.getOwnPropertyDescriptor;
        var getPrototype = Object.getPrototypeOf;
        var functionText = Function.prototype.toString;
        var same = Object.is;
        var apply = Reflect.apply;
        var manager = global.classManager, constructor = global.ClassManager;
        var managerDescriptor = getDescriptor(global, "classManager");
        var constructorDescriptor = getDescriptor(global, "ClassManager");
        var managerPrototype = manager ? getPrototype(manager) : null;
        var sticky = null, states = Object.create(null), wrappers = Object.create(null), descriptors = Object.create(null);
        function fail(reason) {
            if (sticky === null) sticky = reason;
            throw new Error("ClassManager observer violation: " + sticky);
        }
        function dataDescriptorSame(current, initial, value) {
            return current && initial && Object.prototype.hasOwnProperty.call(current, "value") && current.value === value && current.writable === initial.writable && current.enumerable === initial.enumerable && current.configurable === initial.configurable;
        }
        if (!proof || typeof constructor !== "function" || functionText.call(constructor) !== proof.constructorSource || !manager || managerPrototype !== constructor.prototype || !managerDescriptor || !constructorDescriptor) fail("original manager/constructor proof");
        function assertIntact() {
            if (sticky !== null) fail(sticky);
            if (!dataDescriptorSame(getDescriptor(global, "classManager"), managerDescriptor, manager) || !dataDescriptorSame(getDescriptor(global, "ClassManager"), constructorDescriptor, constructor) || getPrototype(manager) !== managerPrototype) fail("manager or constructor binding changed");
            for (var name in wrappers) if (!dataDescriptorSame(getDescriptor(manager, name), descriptors[name], wrappers[name])) fail("allocator method changed: " + name);
            return true;
        }
        function operation(source) {
            var post = /^function\s*\(\s*\)\s*\{\s*return\s+([A-Za-z_$][\w$]*)\s*(\+\+|--)\s*;\s*\}$/.exec(source);
            var pre = /^function\s*\(\s*\)\s*\{\s*return\s+(\+\+|--)\s*([A-Za-z_$][\w$]*)\s*;\s*\}$/.exec(source);
            if (!post && !pre) fail("unsupported allocator increment expression");
            return { prefix: !!pre, direction: (post ? post[2] : pre[1]) === "++" ? 1 : -1, binding: post ? post[1] : pre[2] };
        }
        var names = ["getNewID", "getNewInstanceId"];
        for (var index = 0; index < names.length; index++) (function (name) {
            var expected = proof.methods && proof.methods[name], descriptor = getDescriptor(manager, name);
            if (!expected || !descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value") || typeof descriptor.value !== "function" || functionText.call(descriptor.value) !== expected.source) fail("original allocator source proof: " + name);
            var original = descriptor.value, increment = operation(expected.source);
            if (increment.binding !== expected.counterBinding || increment.prefix !== expected.prefix || increment.direction !== expected.direction || original.length !== 0) fail("allocator expression metadata: " + name);
            var state = { known: false, calls: 0, lastReturned: null, counterValue: null, nextReturned: null };
            states[name] = state;
            var wrapper = function () {
                assertIntact();
                var returned = apply(original, this, arguments);
                if (typeof returned !== "number" || returned % 1 !== 0) fail("allocator returned outside pinned numeric-counter domain: " + name);
                if (state.known && !same(returned, state.nextReturned)) fail("allocator sequence changed or bypassed: " + name);
                state.calls++; state.lastReturned = returned;
                state.counterValue = increment.prefix ? returned : returned + increment.direction;
                state.nextReturned = increment.prefix ? returned + increment.direction : state.counterValue;
                state.known = true;
                return returned;
            };
            // Preserve ordinary name/arity metadata; original functions remain
            // private (including their prototype.constructor bypass route).
            var nameDescriptor = getDescriptor(original, "name");
            if (nameDescriptor) Object.defineProperty(wrapper, "name", nameDescriptor);
            descriptors[name] = descriptor; wrappers[name] = wrapper;
        })(names[index]);
        // Both wrappers must exist before either can be invoked by source code.
        for (var method in wrappers) Object.defineProperty(manager, method, { value: wrappers[method], writable: descriptors[method].writable, enumerable: descriptors[method].enumerable, configurable: descriptors[method].configurable });
        assertIntact();
        function snapshot() {
            assertIntact();
            var classes = states.getNewID, instances = states.getNewInstanceId;
            return { nextClassId: classes.nextReturned, nextInstanceId: instances.nextReturned,
                classCounterValue: classes.counterValue, instanceCounterValue: instances.counterValue,
                lastClassId: classes.lastReturned, lastInstanceId: instances.lastReturned,
                classCalls: classes.calls, instanceCalls: instances.calls,
                classKnown: classes.known, instanceKnown: instances.known };
        }
        return { snapshot: snapshot, assertIntact: assertIntact, finish: snapshot };
    };
})(globalThis);
