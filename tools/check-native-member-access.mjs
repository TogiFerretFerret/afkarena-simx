// Standalone C++ language check. Does not edit or instantiate any VM class.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-member-access');await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=`#include <type_traits>
class Original {int count=7; int *pair(){return &count;} public: Original()=default;};
template<class Tag,typename Tag::type Member>struct Access{friend typename Tag::type member(Tag){return Member;}};
struct Count {using type=int Original::*;friend type member(Count);};
struct Pair {using type=int*(Original::*)();friend type member(Pair);};
template struct Access<Count,&Original::count>;
template struct Access<Pair,&Original::pair>;
static_assert(std::is_same<decltype(member(Count{})),int Original::*>::value,"typed");
static_assert(std::is_same<decltype(member(Pair{})),int*(Original::*)()>::value,"typed");
int main(){Original o;return (o.*member(Count{}))==7 && *(o.*member(Pair{}))()==7 ? 0:1;}
`;
const positive=resolve(directory,'positive.cpp'),negative=resolve(directory,'negative.cpp'),binary=resolve(directory,'positive');
await writeFile(positive,source);await writeFile(negative,'class Original {int count=7;};\nint main(){return &Original::count==nullptr;}\n');
const args=['-std=c++17','-pedantic-errors','-Wall','-Wextra','-Werror','-O2',positive,'-o',binary];
const compiled=spawnSync('c++',args,{encoding:'utf8'});assert.equal(compiled.status,0,compiled.stderr);
const executed=spawnSync(binary,[],{encoding:'utf8'});assert.equal(executed.status,0,executed.stderr);
const rejected=spawnSync('c++',['-std=c++17','-pedantic-errors','-c',negative,'-o',resolve(directory,'negative.o')],{encoding:'utf8'});assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/private/);
const report={version:1,passed:true,compiler:spawnSync('c++',['--version'],{encoding:'utf8'}).stdout,compileArgs:args,source,sourceSha256:sha(source),negativeSource:await readFile(negative,'utf8'),negativeStatus:rejected.status,negativeStderr:rejected.stderr,positiveBinarySha256:sha(await readFile(binary)),scope:'C++17 [temp.explicit] exempts names specifying explicit instantiations from usual access checking. This strict compiler check validates typed member object/function access without changing Original class definition. Negative direct access remains rejected. This is a language/toolchain check, not a VM semantic proof.',producer:{file:'tools/check-native-member-access.mjs',sha256:sha(await readFile(resolve(root,'tools/check-native-member-access.mjs')))}};
await writeFile(resolve(root,'benchmarks/validation/native-member-access.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,directPrivateAccessRejected:true,typedMemberPointers:true}));
