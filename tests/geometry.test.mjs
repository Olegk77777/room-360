import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGETS, RAD, angles, basis, sensorPose, rotateHeading, angularDistance, direction, dot, project, accumulate, finishPixels, wrap } from '../lib/geometry.mjs';
const close=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const vectorClose=(a,b)=>a.forEach((x,i)=>close(x,b[i]));

test('portrait rear camera points at horizon with phone upright',()=>{
  const p=sensorPose(0,90,0);vectorClose(p.forward,[0,1,0]);vectorClose(p.right,[1,0,0]);vectorClose(p.up,[0,0,1]);
  close(angles(sensorPose(90,90,0)).yaw,-90);
});
test('landscape screen rotation preserves visible right and up',()=>{
  const p=sensorPose(0,0,-90,90);vectorClose(p.forward,[1,0,0]);vectorClose(p.up,[0,0,1]);vectorClose(p.right,[0,-1,0]);
});
test('look straight up and down without Euler angle discontinuity in camera projection',()=>{
  vectorClose(sensorPose(0,180,0).forward,[0,0,1]);vectorClose(sensorPose(0,0,0).forward,[0,0,-1]);
  for(const p of [basis(10,90),basis(10,-90)]){const q=project(p.forward,p,48,.75);close(q.x,0);close(q.y,0);assert.ok(q.visible);}
});
test('sensor basis remains orthonormal over tilts, headings and all screen rotations',()=>{
  for(let a=0;a<360;a+=37)for(let b=-170;b<180;b+=29)for(const g of [-80,-40,0,45,87])for(const s of [0,90,-90,180]){
    const p=sensorPose(a,b,g,s);close(dot(p.right,p.up),0);close(dot(p.right,p.forward),0);close(dot(p.up,p.forward),0);for(const v of Object.values(p))close(dot(v,v),1);
  }
});
test('heading calibration and wrap work across 359 -> 0 degrees',()=>{
  const p=rotateHeading(basis(359,12),359);close(angles(p).yaw,0);close(angles(p).pitch,12);
  close(wrap(361),1);close(wrap(-361),-1);close(angularDistance(direction(359,0),direction(1,0)),2);
});
test('targets project to correct screen side and do not reflect behind camera',()=>{
  const p=basis(0,0);assert.ok(project(direction(10,0),p,48,.75).x>0);assert.ok(project(direction(-10,0),p,48,.75).x<0);
  assert.ok(project(direction(0,10),p,48,.75).y<0);assert.equal(project(direction(180,0),p,48,.75).visible,false);
});
test('34 directions cover the entire sphere at the default portrait field of view',()=>{
  assert.equal(TARGETS.length,34);assert.equal(new Set(TARGETS.map(t=>t.id)).size,34);
  const poses=TARGETS.map(t=>basis(t.yaw,t.pitch));let missing=0,total=0;
  for(let lat=-89.5;lat<90;lat+=1)for(let lon=-179.5;lon<180;lon+=1){
    total++;const d=direction(lon,lat);if(!poses.some(p=>{const v=project(d,p,48,.75);return v.visible&&Math.abs(v.x)<.98&&Math.abs(v.y)<.98;}))missing++;
  }
  assert.equal(missing,0,`uncovered ${missing}/${total}`);
});
test('spherical image assembly reconstructs analytical colour environment including seam and poles',()=>{
  const outW=240,outH=120,sums=new Float32Array(outW*outH*3),weights=new Float32Array(outW*outH);
  for(const target of TARGETS){
    const pose=basis(target.yaw,target.pitch),width=72,height=96,hfov=48,tx=Math.tan(hfov*RAD/2),ty=tx/(width/height),pixels=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const u=(x/(width-1)*2-1)*tx,v=(1-y/(height-1)*2)*ty;
      const d=pose.forward.map((a,i)=>a+pose.right[i]*u+pose.up[i]*v),len=Math.hypot(...d),index=(y*width+x)*4;
      for(let c=0;c<3;c++)pixels[index+c]=(d[c]/len+1)*127.5;pixels[index+3]=255;
    }
    accumulate(sums,weights,outW,outH,{pixels,width,height,pose,hfov});
  }
  const result=finishPixels(sums,weights);assert.equal(result.missing,0);let totalError=0,maxError=0;
  for(let y=0;y<outH;y++)for(let x=0;x<outW;x++){
    const d=direction((x+.5)/outW*360-180,90-(y+.5)/outH*180);
    for(let c=0;c<3;c++){const error=Math.abs(result.pixels[(y*outW+x)*4+c]-(d[c]+1)*127.5);totalError+=error;maxError=Math.max(maxError,error);}
  }
  assert.ok(totalError/(outW*outH*3)<.5);assert.ok(maxError<1.5,`max error ${maxError}`);
});
test('incomplete capture reports real missing coverage',()=>{
  const sums=new Float32Array(32*16*3),weights=new Float32Array(32*16);const result=finishPixels(sums,weights);assert.equal(result.missing,1);assert.equal(result.pixels[3],255);
});

for(const aspect of [.5625,1,4/3,16/9])test(`full sphere coverage for camera aspect ${aspect}`,()=>{
  const hfov=2*Math.atan(Math.tan(48*RAD/2)*Math.max(1,aspect))/RAD;
  const poses=TARGETS.map(t=>basis(t.yaw,t.pitch));let missing=0;
  for(let lat=-89.5;lat<90;lat+=1)for(let lon=-179.5;lon<180;lon+=1){
    const d=direction(lon,lat);if(!poses.some(p=>{const v=project(d,p,hfov,aspect);return v.visible&&Math.abs(v.x)<.98&&Math.abs(v.y)<.98;}))missing++;
  }
  assert.equal(missing,0);
});
