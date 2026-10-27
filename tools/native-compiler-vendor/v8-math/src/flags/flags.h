// Build adapter: match `node --v8-options` for Node 24.19.0 / V8 13.6.233.17-node.51.
#ifndef AFK_V8_FLAGS_H
#define AFK_V8_FLAGS_H
namespace v8::internal {
struct V8MathFlags { bool use_std_math_pow; };
inline constexpr V8MathFlags v8_flags{true};
}
#endif
