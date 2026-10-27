import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
let decompressor;
function originalDecompressor(){
  if(decompressor)return decompressor;
  const manifest=JSON.parse(readFileSync(resolve(root,'config/bootstrap-packed-config.json'),'utf8'));
  const record=manifest.decompressor;
  const source=readFileSync(resolve(root,record.source),'utf8').slice(record.start,record.end);
  assert.equal(createHash('sha256').update(source).digest('hex'),record.sha256,'Stale original LZ4 source');
  const context=createContext({window:{ed:{}}});
  runInContext(source+';',context,{filename:`${record.source}:${record.start}`});
  decompressor=context.ed.Lz4.decompress;
  return decompressor;
}

/** Decode the supplied, already-decrypted #$ container with original game LZ4. */
export function decodeBootstrapPackedConfig(input){
  const buffer=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
  if(buffer.length<18||buffer[4]!==35||buffer[5]!==36)throw new Error('Unsupported packed/encrypted config header');
  const headerEnd=buffer.readUInt32LE(0)+4;
  if(headerEnd<18||headerEnd+4>buffer.length)throw new Error('Invalid packed config header length');
  const filenameLength=buffer.readUInt32LE(6),md5LengthOffset=10+filenameLength;
  if(md5LengthOffset+4>headerEnd)throw new Error('Invalid packed config filename length');
  const filename=buffer.subarray(10,md5LengthOffset).toString('utf8');
  const md5Length=buffer.readUInt32LE(md5LengthOffset),md5Start=md5LengthOffset+4;
  if(md5Length!==32||md5Start+md5Length!==headerEnd)throw new Error('Invalid packed config digest header');
  const expectedMd5=buffer.subarray(md5Start,headerEnd).toString('ascii');
  if(!/^[a-f0-9]{32}$/i.test(expectedMd5))throw new Error('Invalid packed config digest');
  const length=buffer.readUInt32LE(headerEnd);
  if(length===0||length>256*1024*1024)throw new Error('Invalid packed config decompressed length');
  const payload=new Uint8Array(buffer.buffer,buffer.byteOffset+headerEnd,buffer.length-headerEnd);
  const decoded=originalDecompressor()(payload,4,length);
  if(decoded.length!==length)throw new Error('Packed config decompressed length mismatch');
  const data=Buffer.from(decoded);
  const md5=createHash('md5').update(data).digest('hex');
  if(md5!==expectedMd5.toLowerCase())throw new Error('Packed config MD5 mismatch');
  return {data,filename,md5};
}
