import { angles, clamp, dot, project, wrap } from './geometry.mjs';

// Изображение заполняет экран (object-fit: cover). Точка использует тот же масштаб.
export function viewfinderGuide(target, pose, hfov, videoWidth, videoHeight, width, height) {
  const w=Math.max(1,width),h=Math.max(1,height);
  const scale=Math.max(w/videoWidth,h/videoHeight);
  const point=project(target,pose,hfov,videoWidth/videoHeight);
  const x=point.x*videoWidth*scale/2,y=point.y*videoHeight*scale/2;
  // В верхней/нижней полосе живут кнопки. Стрелка не попадает под них.
  const limitX=Math.max(28,w/2-35),limitUp=Math.max(28,h/2-110),limitDown=Math.max(28,h/2-(w>h?105:190));
  const offscreen=!point.visible||Math.abs(x)>limitX||(y<0?-y>limitUp:y>limitDown);
  const a=angles(pose),t=angles({forward:target}),wrappedYaw=wrap(t.yaw-a.yaw),yaw=wrappedYaw===-180?180:wrappedYaw,pitch=t.pitch-a.pitch;
  let dx=x,dy=y;
  if(!point.visible){
    dx=dot(target,pose.right);dy=-dot(target,pose.up);
    // Строго позади: выбираем один устойчивый путь, без отражения проекции.
    if(Math.hypot(dx,dy)<0.02){const vertical=Math.abs(pitch)>90;dx=vertical?0:(yaw>=0?1:-1);dy=vertical?(pitch>0?-1:1):0;}
    dx*=w;dy*=h;
  }
  const edgeScale=offscreen?1/Math.max(Math.abs(dx)/limitX,Math.abs(dy)/(dy<0?limitUp:limitDown),0.0001):1;
  const vertical=Math.abs(t.pitch)>85||Math.abs(pitch)>Math.abs(yaw)*0.7;
  const instruction=vertical?(pitch>0?'Наклоните вверх':'Наклоните вниз'):(yaw>=0?'Поверните вправо':'Поверните влево');
  return {x:clamp(offscreen?dx*edgeScale:x,-limitX,limitX),y:clamp(offscreen?dy*edgeScale:y,-limitUp,limitDown),offscreen,arrow:Math.atan2(dy,dx)*180/Math.PI,instruction};
}
