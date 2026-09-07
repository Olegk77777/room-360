import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { addPanoramaMetadata, exportSources } from '../lib/export.ts';
import { basis } from '../lib/geometry.mjs';

test('GPano APP1 metadata preserves original JPEG bytes and valid segment length',async()=>{
  const original=new Uint8Array([255,216,255,224,0,2,255,217]);
  const result=new Uint8Array(await (await addPanoramaMetadata(new Blob([original]),3072,1536)).arrayBuffer());
  assert.deepEqual(Array.from(result.slice(0,4)),[255,216,255,225]);
  const length=(result[4]<<8)+result[5],payload=new TextDecoder().decode(result.slice(6,4+length));
  assert.ok(payload.startsWith('http://ns.adobe.com/xap/1.0/\0'));
  assert.match(payload,/GPano:ProjectionType="equirectangular"/);
  assert.match(payload,/GPano:FullPanoWidthPixels="3072"/);
  assert.match(payload,/GPano:FullPanoHeightPixels="1536"/);
  assert.deepEqual(result.slice(4+length),original.slice(2));
});
test('invalid image is not marked as a JPEG panorama',async()=>{
  await assert.rejects(()=>addPanoramaMetadata(new Blob(['bad']),3072,1536),/JPEG/);
});
test('ZIP preserves photograph bytes and pose metadata without blob serialization',async()=>{
  const content=new Uint8Array([255,216,1,2,3,255,217]);
  const shot={id:0,blob:new Blob([content]),pose:basis(12,8),hfov:48,width:1440,height:1920,created:1000,manual:false};
  const archive=unzipSync(new Uint8Array(await (await exportSources([shot])).arrayBuffer()));
  assert.deepEqual(archive['frame-01.jpg'],content);
  const manifest=JSON.parse(strFromU8(archive['capture.json']));assert.equal(manifest.shots.length,1);
  assert.equal(manifest.shots[0].file,'frame-01.jpg');assert.equal(manifest.shots[0].hfov,48);assert.equal('blob' in manifest.shots[0],false);
  assert.deepEqual(manifest.shots[0].pose,shot.pose);
});
