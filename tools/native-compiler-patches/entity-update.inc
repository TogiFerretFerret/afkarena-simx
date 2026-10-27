// Standalone opt-in helper: no source state is copied into a second world.
#include "hermes/VM/StaticHUtils.h"
#include "hermes/VM/JSArray.h"
#include <cmath>

namespace hermes { namespace vm {
extern "C" SHERMES_EXPORT bool simx_entity_update(
    SHRuntime *shr, SHLegacyValue input, SHLegacyValue delta,
    SHSymbolID positionID, SHSymbolID velocityID, SHSymbolID directionID,
    double (*component)(double, double, double),
    unsigned char (*shouldFlip)(double, double),
    unsigned char (*referenceFP)()) {
#if defined(HERMESVM_BOXED_DOUBLES) || defined(HERMESVM_COMPRESSED_POINTERS)
  // Number encoding can allocate in these layouts: do not borrow storage.
  return false;
#else
  Runtime &runtime = getRuntime(shr);
  NoAllocScope noAlloc(runtime);
  auto value = HermesValue::fromRaw(input.raw);
  auto dt = HermesValue::fromRaw(delta.raw);
  if (!value.isObject() || !dt.isNumber() || !std::isfinite(dt.getNumber()) ||
      !referenceFP()) return false;
  auto *entity = vmcast<JSObject>(value);
  if (entity->getKind() != CellKind::JSObjectKind ||
      entity->getClass(runtime)->isFrozen()) return false;
  NamedPropertyDescriptor positionDesc, velocityDesc, directionDesc;
  auto ownData = [&](SHSymbolID id, NamedPropertyDescriptor &d) {
    auto found = JSObject::tryGetOwnNamedDescriptorFast(
        entity, runtime, SymbolID::unsafeCreate(id), d);
    return found.hasValue() && found.getValue() && !d.flags.accessor &&
        !d.flags.internalSetter && !d.flags.proxyObject && !d.flags.hostObject;
  };
  if (!ownData(positionID, positionDesc) || !ownData(velocityID, velocityDesc) ||
      !ownData(directionID, directionDesc) || !directionDesc.flags.writable)
    return false;
  auto position = JSObject::getNamedSlotValueUnsafe(entity, runtime, positionDesc).unboxToHV(runtime);
  auto velocity = JSObject::getNamedSlotValueUnsafe(entity, runtime, velocityDesc).unboxToHV(runtime);
  auto direction = JSObject::getNamedSlotValueUnsafe(entity, runtime, directionDesc).unboxToHV(runtime);
  if (!vmisa<JSArray>(position) || !vmisa<JSArray>(velocity) ||
      !direction.isNumber() || !std::isfinite(direction.getNumber())) return false;
  auto *p = vmcast<JSArray>(position);
  auto *v = vmcast<JSArray>(velocity);
  auto denseFinite = [&](JSArray *a) {
    if (!a->hasFastIndexProperties(runtime) || a->getBeginIndex() != 0 ||
        a->getEndIndex() < 2) return false;
    auto x = a->at(runtime, 0).unboxToHV(runtime);
    auto y = a->at(runtime, 1).unboxToHV(runtime);
    return x.isNumber() && y.isNumber() &&
        std::isfinite(x.getNumber()) && std::isfinite(y.getNumber());
  };
  if (p->getClass(runtime)->isFrozen() || !denseFinite(p) || !denseFinite(v))
    return false;
  // All guards finished BEFORE the first write. This block allocates nothing,
  // invokes no JS, and retains the original VM arrays, aliases and GC barriers.
  // Finite inputs guarantee stored results are finite or infinite, never NaN.
  auto read = [&](JSArray *a, unsigned index) {
    return a->at(runtime, index).unboxToHV(runtime).getNumber();
  };
  auto write = [&](unsigned index, double number) {
    p->getIndexedStorageUnsafe(runtime)->set(index,
        SmallHermesValue::encodeNumberValue(number, runtime), runtime.getHeap());
  };
  write(0, component(read(p, 0), read(v, 0), dt.getNumber()));
  // Do not move this read before the preceding write: source captures references.
  write(1, component(read(p, 1), read(v, 1), dt.getNumber()));
  if (shouldFlip(read(v, 0), direction.getNumber()))
    JSObject::setNamedSlotValueUnsafe(entity, runtime, directionDesc,
        SmallHermesValue::encodeNumberValue(-direction.getNumber(), runtime));
  return true;
#endif
}
}} // namespace hermes::vm
