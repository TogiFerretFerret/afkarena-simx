import { spawnSync } from 'node:child_process';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Bounded, public, read-only probes. No authentication, installers or bulk
// guessing. Only source-declared patch prefixes and version suffix are tested.
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'work/public-render-probe');await mkdir(out,{recursive:true});
const host='https://hgame-cdn.lilithgame.com/hdgame/global/v2/',path='res/fcaz/effect/effect_Mag.fcasz';
const manifest=JSON.parse(await readFile(resolve(root,'src/checkversion.md5'),'utf8'));
const expected=manifest[path];if(expected!=='42787b27ba1b5faf3bf135441cad0c93')throw Error('Source asset digest changed');
const urls=[
 host+'rel/patches_new/'+path+'.367744',
 host+'patches_new/'+path+'.367744',
 host+'rel/'+path+'.367744',
 host+'rel/patches_new/'+path+'.'+expected,
 host+'patches_new/'+path+'.'+expected,
 host+'patches_new/afkarena_v2.303.03.367744-afkarena_v2.305.03.371849.patch'
];
const probes=[];
for(let i=0;i<urls.length;i++){
 const body=resolve(out,`${i}.body`),result=spawnSync('curl',['-L','--max-time','15','--max-filesize','2097152','-sS','-w','%{http_code}\n%{size_download}\n%{url_effective}','-o',body,urls[i]],{encoding:'utf8'});
 let bytes;try{bytes=await readFile(body)}catch{bytes=Buffer.alloc(0)}
 const fields=result.stdout.trim().split('\n'),asset=i<5,md5=createHash('md5').update(bytes).digest('hex');
 probes.push({url:urls[i],status:Number(fields[0])||null,bytes:bytes.length,curlExit:result.status,diagnostic:result.stderr.trim(),sha256:createHash('sha256').update(bytes).digest('hex'),...(asset?{expectedMd5:expected,actualMd5:md5,accepted:result.status===0&&Number(fields[0])===200&&md5===expected}:{kind:'source-declared-version-transition-patch'})});
}
const report={version:1,scope:'Bounded public read-only original asset route investigation',sourceAsset:{path,expectedMd5:expected},sourceRoutingEvidence:[{file:'src/script/jsb_boot.js',line:6778,expression:'setPreDownloadSuffix(this.localNextVersion.substring(tempPos))',meaning:'Native pre-download suffix is the numeric version including leading dot'},{file:'src/script/jsb_boot.js',line:4374,expression:'cc.getGameCdn() + preffix + "/" + patch_file',meaning:'Version-transition patch uses patches_new outside rel/'}],probes,acceptedAssets:probes.filter(p=>p.accepted).length,qualifiesForThroughputTarget:false,limitations:['Native hg.ResourceManager final resource URL construction remains absent','HTTP404 for these routes does not establish absence on all CDN routes','No unmatched/current-version asset is accepted for the pinned source snapshot']};
await writeFile(resolve(root,'benchmarks/validation/public-render-asset-routing.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
