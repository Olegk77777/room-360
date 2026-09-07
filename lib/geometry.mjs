// Система координат: X — вправо, Y — вперёд, Z — вверх.
export const RAD = Math.PI / 180;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const wrap = (x) => ((x + 180) % 360 + 360) % 360 - 180;
export const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export function direction(yaw, pitch) {
  return [Math.sin(yaw*RAD)*Math.cos(pitch*RAD), Math.cos(yaw*RAD)*Math.cos(pitch*RAD), Math.sin(pitch*RAD)];
}
export function basis(yaw, pitch) {
  const y=yaw*RAD, p=pitch*RAD;
  return {right:[Math.cos(y),-Math.sin(y),0], up:[-Math.sin(y)*Math.sin(p),-Math.cos(y)*Math.sin(p),Math.cos(p)], forward:direction(yaw,pitch)};
}
export function angles(pose) {
  return {yaw:Math.atan2(pose.forward[0],pose.forward[1])/RAD, pitch:Math.asin(clamp(pose.forward[2],-1,1))/RAD};
}
export function rotateHeading(pose, origin) {
  const c=Math.cos(origin*RAD), s=Math.sin(origin*RAD);
  const rotate=v=>[c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]];
  return {right:rotate(pose.right),up:rotate(pose.up),forward:rotate(pose.forward)};
}
export function sensorPose(alpha, beta, gamma, screenAngle=0) {
  // W3C intrinsic Z-X-Y. Задняя камера смотрит вдоль -Z устройства.
  const a=alpha*RAD,b=beta*RAD,g=gamma*RAD;
  const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cg=Math.cos(g),sg=Math.sin(g);
  const x=[ca*cg-sa*sb*sg,sa*cg+ca*sb*sg,-cb*sg];
  const y=[-sa*cb,ca*cb,sb];
  const forward=[-ca*sg-sa*sb*cg,-sa*sg+ca*sb*cg,-cb*cg];
  const c=Math.cos(screenAngle*RAD),s=Math.sin(screenAngle*RAD);
  return {right:x.map((v,i)=>c*v-s*y[i]),up:y.map((v,i)=>c*v+s*x[i]),forward};
}
export function angularDistance(a,b) { return Math.acos(clamp(dot(a,b),-1,1))/RAD; }
export function project(target,pose,hfov,aspect) {
  const z=dot(target,pose.forward), tx=Math.tan(hfov*RAD/2),ty=tx/aspect;
  return {x:dot(target,pose.right)/(Math.max(z,0.001)*tx),y:-dot(target,pose.up)/(Math.max(z,0.001)*ty),visible:z>0};
}
export const TARGETS = [
  ...Array.from({length:12},(_,i)=>({yaw:i*30,pitch:0,ring:'Стены',label:`Стены · ${i+1} из 12`})),
  ...Array.from({length:10},(_,i)=>({yaw:wrap(330-i*36),pitch:45,ring:'Выше',label:`Выше · ${i+1} из 10`})),
  {yaw:6,pitch:90,ring:'Потолок',label:'Прямо вверх'},
  ...Array.from({length:10},(_,i)=>({yaw:wrap(6+i*36),pitch:-45,ring:'Ниже',label:`Ниже · ${i+1} из 10`})),
  {yaw:330,pitch:-90,ring:'Пол',label:'Прямо вниз'},
].map((t,id)=>({...t,id,vector:direction(t.yaw,t.pitch)}));

// Один снимок добавляется в накопитель сферы. Память не зависит от числа снимков.
export function accumulate(acc, weights, outWidth, outHeight, shot) {
  const {pixels,width,height,pose,hfov}=shot;
  const tx=Math.tan(hfov*RAD/2),ty=tx/(width/height);
  const sine=new Float64Array(outWidth),cosine=new Float64Array(outWidth);
  for(let x=0;x<outWidth;x++){const lon=((x+0.5)/outWidth*2-1)*Math.PI;sine[x]=Math.sin(lon);cosine[x]=Math.cos(lon);}
  for(let y=0;y<outHeight;y++){
    const lat=(0.5-(y+0.5)/outHeight)*Math.PI,cp=Math.cos(lat),dz=Math.sin(lat);
    for(let x=0;x<outWidth;x++){
      const dx=sine[x]*cp,dy=cosine[x]*cp;
      const z=dx*pose.forward[0]+dy*pose.forward[1]+dz*pose.forward[2];
      if(z<=0)continue;
      const u=(dx*pose.right[0]+dy*pose.right[1]+dz*pose.right[2])/(z*tx);
      const v=-(dx*pose.up[0]+dy*pose.up[1]+dz*pose.up[2])/(z*ty);
      if(Math.abs(u)>=0.995||Math.abs(v)>=0.995)continue;
      const weight=Math.pow(Math.max(0.001,(1-u*u)*(1-v*v)),2);
      const fx=(u+1)*0.5*(width-1),fy=(v+1)*0.5*(height-1),ix=Math.floor(fx),iy=Math.floor(fy),ax=fx-ix,ay=fy-iy;
      const p=(iy*width+ix)*4,p1=p+4,p2=p+width*4,p3=p2+4,idx=y*outWidth+x;
      for(let c=0;c<3;c++){
        const value=pixels[p+c]*(1-ax)*(1-ay)+pixels[p1+c]*ax*(1-ay)+pixels[p2+c]*(1-ax)*ay+pixels[p3+c]*ax*ay;
        acc[idx*3+c]+=value*weight;
      }
      weights[idx]+=weight;
    }
  }
}
export function finishPixels(acc, weights) {
  const pixels=new Uint8ClampedArray(weights.length*4);let missing=0;
  for(let i=0;i<weights.length;i++){
    if(weights[i]<0.000001){missing++;pixels[i*4]=17;pixels[i*4+1]=21;pixels[i*4+2]=19;}
    else for(let c=0;c<3;c++)pixels[i*4+c]=acc[i*3+c]/weights[i];
    pixels[i*4+3]=255;
  }
  return {pixels,missing:missing/weights.length};
}
