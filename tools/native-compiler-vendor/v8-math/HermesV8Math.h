// V8 math declarations used by Hermes. Algorithms are unmodified Node/V8 source.
// V8 BSD license retained in tools/native-compiler-vendor/v8-math/LICENSE.
#ifndef HERMES_SUPPORT_V8_MATH_H
#define HERMES_SUPPORT_V8_MATH_H
namespace v8::base::ieee754 {
double acos(double); double acosh(double); double asin(double); double asinh(double);
double atan(double); double atan2(double,double); double atanh(double); double cbrt(double);
double cos(double); double cosh(double); double exp(double); double expm1(double);
double log(double); double log10(double); double log1p(double); double log2(double);
double sin(double); double sinh(double); double tan(double); double tanh(double);
}
namespace v8::internal::math { double pow(double,double); }
#endif
