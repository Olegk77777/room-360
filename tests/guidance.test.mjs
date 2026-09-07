import test from 'node:test';
import assert from 'node:assert/strict';
import { basis, direction, sensorPose, dot } from '../lib/geometry.mjs';
import { viewfinderGuide } from '../lib/guidance.mjs';
import { cameraConstraints, cameraPose } from '../lib/camera.mjs';
const portrait=(yaw,pitch=0,pose=basis(0,0))=>viewfinderGuide(direction(yaw,pitch),pose,61.39,1920,1440,390,844);

test('horizontal camera crop uses cover scale: central point stays central',()=>{
  const g=portrait(0);assert.equal(g.offscreen,false);assert.ok(Math.abs(g.x)<1e-7);assert.ok(Math.abs(g.y)<1e-7);
  const r=portrait(8);assert.ok(r.x>100&&r.x<155);assert.equal(r.offscreen,false);
});
test('a target inside the full photograph but outside the visible crop becomes an edge arrow',()=>{
  const g=portrait(25);assert.equal(g.offscreen,true);assert.ok(g.x>0&&g.x<=160);assert.equal(g.instruction,'Поверните вправо');
  const left=portrait(-25);assert.equal(left.offscreen,true);assert.ok(left.x<0&&left.x>=-160);
});
test('targets behind the camera are not reflected to the wrong side',()=>{
  for(const yaw of [95,150,179])assert.ok(portrait(yaw).x>0);
  for(const yaw of [-95,-150,-179])assert.ok(portrait(yaw).x<0);
  const opposite=portrait(180);assert.ok(opposite.x>0);assert.equal(opposite.instruction,'Поверните вправо');
});
test('ceiling to lower ring guides down despite a jump in yaw at the pole',()=>{
  const g=portrait(6,-45,basis(-25,88));assert.ok(g.y>0);assert.equal(g.instruction,'Наклоните вниз');assert.ok(g.offscreen);
  const down=portrait(0,-90,basis(0,90));assert.ok(down.y>0);assert.equal(down.instruction,'Наклоните вниз');
  const up=portrait(0,90,basis(0,-90));assert.ok(up.y<0);assert.equal(up.instruction,'Наклоните вверх');
});
test('heading wrap chooses the short turn around zero degrees',()=>{
  assert.ok(portrait(1,0,basis(359,0)).x>0);assert.ok(portrait(359,0,basis(1,0)).x<0);
});
test('arrows stay clear of controls across portrait and landscape screen sizes',()=>{
  for(const [w,h] of [[320,568],[390,844],[844,390],[1024,768]])for(let yaw=-180;yaw<180;yaw+=15)for(let pitch=-90;pitch<=90;pitch+=15){
    const g=viewfinderGuide(direction(yaw,pitch),basis(0,0),61.39,1920,1440,w,h);
    for(const v of [g.x,g.y,g.arrow])assert.ok(Number.isFinite(v));
    assert.ok(g.x+w/2>=35&&g.x+w/2<=w-35);
    assert.ok(g.y+h/2>=110-1e-6);
    assert.ok(g.y+h/2<=h-(w>h?105:190)+1e-6);
  }
});
test('explicit camera selection requests that exact camera instead of a facing-mode fallback',()=>{
  const explicit=cameraConstraints('chosen-lens');assert.deepEqual(explicit.video.deviceId,{exact:'chosen-lens'});assert.equal('facingMode' in explicit.video,false);
  assert.deepEqual(cameraConstraints().video.facingMode,{ideal:'environment'});assert.equal(cameraConstraints().audio,false);
});
test('front camera direction and basis are correct without mirroring the pixels',()=>{
  const rear=sensorPose(0,90,0),front=cameraPose(rear,'user');
  assert.ok(front.forward[1]<-.99);assert.ok(front.right[0]<-.99);assert.ok(front.up[2]>.99);
  assert.ok(Math.abs(dot(front.forward,front.up))<1e-8);assert.ok(Math.abs(dot(front.forward,front.right))<1e-8);
  assert.deepEqual(cameraPose(front,'user'),rear);
});
