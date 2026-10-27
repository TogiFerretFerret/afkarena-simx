// DESIGN ONLY. Not compiled or installed. Add these PUBLIC member functions
// inside the pinned classes; no data members or object-layout changes.
// DictPropertyMap:
static bool tryDescriptorOrdinalHint(
    DictPropertyMap *self, SymbolID name, uint32_t &ordinal,
    NamedPropertyDescriptor &descriptor) {
  if (!name.isValid()) return false;
  const auto count=self->numDescriptors_.load(std::memory_order_relaxed);
  if (ordinal<count) {
    const auto &pair=self->getDescriptorPairs()[ordinal];
    if (pair.first==name) {descriptor=pair.second;return true;}
  }
  // find/getDescriptorPair operate on CURRENT valid PropertyPos only.
  auto found=DictPropertyMap::find(self,name);
  if (!found) return false;
  const auto *pair=DictPropertyMap::getDescriptorPair(self,*found);
  ordinal=static_cast<uint32_t>(pair-self->getDescriptorPairs());
  descriptor=pair->second;
  return true;
}
// HiddenClass: counterpart only accesses current map, never parent-chain maps.
static bool tryOwnDescriptorOrdinalHint(
    HiddenClass *self, PointerBase &base, SymbolID name, uint32_t &ordinal,
    NamedPropertyDescriptor &descriptor) {
  if (!self->propertyMap_) return false;
  return DictPropertyMap::tryDescriptorOrdinalHint(
      self->propertyMap_.getNonNull(base),name,ordinal,descriptor);
}
// Caller BEFORE this accessor must reject all nonordinary/lazy/typed/exotic
// receivers and unsupported/private/indexed names. Caller AFTER it must reject
// invalid/accessor/indexed/internalSetter/hostObject/staticBuiltin/proxyObject/
// privateName/flagsTransition descriptors, load current receiver slot using the
// original SmallHermesValue decoder, and fallback on Empty. All under NoAlloc.
// Configurable/read-only flags are safe for reads because descriptor is current.
// Never install ordinal as an existing Hermes shape+slot property cache entry!
