// Copyright 2014 the V8 project authors. All rights reserved.
// BSD license retained in ../../LICENSE.
// Minimal build adapter containing the exact bit_cast implementation used by ieee754.cc.
#ifndef AFK_V8_MACROS_H
#define AFK_V8_MACROS_H
#include <cstring>
#include <limits>
#include <type_traits>
#include "src/base/base-export.h"
#define V8_INLINE inline
#define V8_WARN_UNUSED_RESULT __attribute__((warn_unused_result))
#define V8_HAS_BUILTIN_BIT_CAST 0
namespace v8::base {
template <class Dest, class Source>
V8_INLINE Dest bit_cast(Source const& source) {
  static_assert(!std::is_pointer_v<Source>, "bit_cast must not be used on pointer types");
  static_assert(!std::is_pointer_v<Dest>, "bit_cast must not be used on pointer types");
  static_assert(!std::is_reference_v<Dest>, "bit_cast must not be used on reference types");
  static_assert(sizeof(Dest) == sizeof(Source), "bit_cast requires source and destination types to be the same size");
  static_assert(std::is_trivially_copyable_v<Source>, "bit_cast requires the source type to be trivially copyable");
  static_assert(std::is_trivially_copyable_v<Dest>, "bit_cast requires the destination type to be trivially copyable");
  Dest dest;
  memcpy(&dest, &source, sizeof(dest));
  return dest;
}
}
#endif
