// Private diagnostic host hook: SHA-256 over Node-compatible UTF-8 encoding.
// Round schedule/constants are a direct unsigned translation of the pinned
// portableTraceSha256 implementation. This is not a battle-mechanics fast path.
#include "hermes/VM/StaticHUtils.h"
#include "hermes/VM/StringView.h"
#include <cstdint>
namespace hermes { namespace vm { namespace {
class SimxDiagnosticSha256 {
  uint32_t h_[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  uint8_t block_[64]{};unsigned used_=0;uint64_t length_=0;
  static uint32_t r(uint32_t x,unsigned n){return (x>>n)|(x<<(32-n));}
  void compress(){
    static constexpr uint32_t k[64]={0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
    uint32_t w[64];for(unsigned j=0;j<16;j++)w[j]=(uint32_t(block_[4*j])<<24)|(uint32_t(block_[4*j+1])<<16)|(uint32_t(block_[4*j+2])<<8)|block_[4*j+3];
    for(unsigned j=16;j<64;j++)w[j]=(r(w[j-15],7)^r(w[j-15],18)^(w[j-15]>>3))+w[j-16]+(r(w[j-2],17)^r(w[j-2],19)^(w[j-2]>>10))+w[j-7];
    uint32_t a=h_[0],b=h_[1],c=h_[2],d=h_[3],e=h_[4],f=h_[5],g=h_[6],hh=h_[7];
    for(unsigned j=0;j<64;j++){uint32_t t1=hh+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[j]+w[j],t2=(r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c));hh=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;}
    h_[0]+=a;h_[1]+=b;h_[2]+=c;h_[3]+=d;h_[4]+=e;h_[5]+=f;h_[6]+=g;h_[7]+=hh;
  }
 public:
  void byte(uint8_t b){block_[used_++]=b;++length_;if(used_==64){compress();used_=0;}}
  void codepoint(uint32_t c){if(c<128)byte(c);else if(c<2048){byte(192|(c>>6));byte(128|(c&63));}else if(c<65536){byte(224|(c>>12));byte(128|((c>>6)&63));byte(128|(c&63));}else{byte(240|(c>>18));byte(128|((c>>12)&63));byte(128|((c>>6)&63));byte(128|(c&63));}}
  void finish(char hex[64]){uint64_t bits=length_*8;byte(128);while(used_!=56)byte(0);for(int shift=56;shift>=0;shift-=8)byte(uint8_t(bits>>shift));static constexpr char digits[]="0123456789abcdef";for(unsigned i=0;i<32;i++){uint8_t b=uint8_t(h_[i/4]>>(24-8*(i%4)));hex[2*i]=digits[b>>4];hex[2*i+1]=digits[b&15];}}
};
}
static CallResult<HermesValue> simxDiagnosticDigestString(Runtime &runtime,HermesValue value){
  GCScope scope(runtime);
  auto rooted=runtime.makeHandle(vmcast<StringPrimitive>(value));
  auto view=StringPrimitive::createStringView(runtime,rooted);SimxDiagnosticSha256 sha;
  for(uint32_t i=0;i<view.length();i++){uint32_t c=view[i];if(c>=0xd800&&c<=0xdbff){uint32_t next=i+1<view.length()?view[i+1]:0;if(next>=0xdc00&&next<=0xdfff){c=0x10000+((c-0xd800)<<10)+(next-0xdc00);++i;}else c=0xfffd;}else if(c>=0xdc00&&c<=0xdfff)c=0xfffd;sha.codepoint(c);}
  char hex[64];sha.finish(hex);auto output=StringPrimitive::create(runtime,ASCIIRef(hex,64));
  if(output==ExecutionStatus::EXCEPTION)return ExecutionStatus::EXCEPTION;
  return *output;
}
extern "C" SHERMES_EXPORT SHLegacyValue simx_diagnostic_sha256(SHRuntime *shr,SHLegacyValue input){
  auto value=HermesValue::fromRaw(input.raw);
  // No JS property reads for boxes/proxies or other unsupported inputs.
  if(!value.isString())return SHLegacyValue{HermesValue::encodeUndefinedValue().getRaw()};
  auto output=simxDiagnosticDigestString(getRuntime(shr),value);
  if(output==ExecutionStatus::EXCEPTION)_sh_throw_current(shr);
  return SHLegacyValue{output->getRaw()};
}
}}
