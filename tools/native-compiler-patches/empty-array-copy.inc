// Standalone opt-in helper. No live compiler patch is installed by this file.
#include "hermes/VM/StaticHUtils.h"
#include "hermes/VM/JSArray.h"
#include "hermes/VM/Callable.h"

namespace hermes { namespace vm {
CallResult<HermesValue> objectKeys(void *, Runtime &);
extern "C" SHERMES_EXPORT SHLegacyValue simx_empty_array_copy(
    SHRuntime *shr, SHLegacyValue input) {
  Runtime &runtime = getRuntime(shr);
  auto result = [](HermesValue v) { return SHLegacyValue{v.getRaw()}; };
  const auto fallback = HermesValue::encodeUndefinedValue();
  auto value = HermesValue::fromRaw(input.raw);
  if (!vmisa<JSArray>(value)) return result(fallback);
  auto *array = vmcast<JSArray>(value);
  // The exact default class has only the ordinary non-enumerable length slot.
  // Reject custom own constructors, symbols, getters and descriptor changes.
  if (array->getClass(runtime) != runtime.classJSArray.get() ||
      array->getParent(runtime) != runtime.arrayPrototype.get() ||
      !array->isExtensible(runtime) || JSArray::getLength(array, runtime) != 0)
    return result(fallback);
  auto ownData = [&](JSObject *object, SymbolID key, PinnedHermesValue &v) {
    if (object->isProxyObject(runtime) || object->isHostObject(runtime)) return false;
    NamedPropertyDescriptor d;
    auto found = JSObject::tryGetOwnNamedDescriptorFast(object, runtime, key, d);
    if (!found.hasValue() || !found.getValue() || d.flags.accessor) return false;
    v = JSObject::getNamedSlotValueUnsafe(object, runtime, d).unboxToHV(runtime);
    return true;
  };
  PinnedHermesValue constructor, object, keys;
  if (!ownData(runtime.arrayPrototype.get(),
               Predefined::getSymbolID(Predefined::constructor), constructor) ||
      constructor.getRaw() != runtime.arrayConstructor.getHermesValue().getRaw() ||
      !ownData(runtime.getGlobal().get(),
               Predefined::getSymbolID(Predefined::Object), object) ||
      object.getRaw() != runtime.objectConstructor.getHermesValue().getRaw() ||
      !ownData(vmcast<JSObject>(object),
               Predefined::getSymbolID(Predefined::keys), keys) ||
      !vmisa<NativeFunction>(keys) ||
      vmcast<NativeFunction>(keys)->getFunctionPtr() != objectKeys)
    return result(fallback);
  // Source calls new intrinsic Array() and Object.keys(empty) then no writes.
  // The original Array constructor uses these SAME prototype/class roots when
  // new.target is the intrinsic constructor (Array.cpp arrayConstructor).
  auto created = JSArray::create(runtime, 0, 0);
  if (created == ExecutionStatus::EXCEPTION) _sh_throw_current(shr);
  return result(created->getHermesValue());
}
}}
