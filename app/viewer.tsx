import { useEffect, useRef, useState } from 'react';

const vertex=`attribute vec2 position;varying vec2 uv;void main(){uv=position;gl_Position=vec4(position,0.,1.);}`;
const fragment=`precision highp float;varying vec2 uv;uniform sampler2D panorama;uniform float yaw;uniform float pitch;uniform float aspect;
void main(){vec3 d=normalize(vec3(uv.x*aspect*.65,1.,uv.y*.65));float cp=cos(pitch),sp=sin(pitch);d=vec3(d.x,d.y*cp-d.z*sp,d.y*sp+d.z*cp);float cy=cos(yaw),sy=sin(yaw);d=vec3(d.x*cy+d.y*sy,d.y*cy-d.x*sy,d.z);vec2 p=vec2(fract(atan(d.x,d.y)/6.28318530718+.5),.5-asin(clamp(d.z,-1.,1.))/3.14159265359);gl_FragColor=texture2D(panorama,p);}`;

export function Viewer({url}:{url:string}){
  const canvas=useRef<HTMLCanvasElement>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;const gl=el.getContext('webgl',{alpha:false,antialias:false});
    if(!gl){const raf=requestAnimationFrame(()=>setFailed(true));return()=>cancelAnimationFrame(raf);}
    let disposed=false;let yaw=0,pitch=0,drag:{x:number;y:number}|null=null;
    const program=gl.createProgram()!;
    const shaders=[gl.VERTEX_SHADER,gl.FRAGMENT_SHADER].map((type,i)=>{
      const shader=gl.createShader(type)!;gl.shaderSource(shader,[vertex,fragment][i]);gl.compileShader(shader);gl.attachShader(program,shader);return shader;
    });
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const raf=requestAnimationFrame(()=>setFailed(true));return()=>cancelAnimationFrame(raf);}
    const bindProgram=gl.useProgram.bind(gl);bindProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const draw=()=>{if(disposed)return;const r=el.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,2);el.width=Math.round(r.width*dpr);el.height=Math.round(r.height*dpr);gl.viewport(0,0,el.width,el.height);gl.uniform1f(gl.getUniformLocation(program,'yaw'),yaw);gl.uniform1f(gl.getUniformLocation(program,'pitch'),pitch);gl.uniform1f(gl.getUniformLocation(program,'aspect'),el.width/el.height);gl.drawArrays(gl.TRIANGLES,0,6);};
    const image=new Image();image.onload=()=>{if(disposed)return;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);draw();};image.onerror=()=>setFailed(true);image.src=url;
    const down=(e:PointerEvent)=>{drag={x:e.clientX,y:e.clientY};el.setPointerCapture(e.pointerId);};
    const move=(e:PointerEvent)=>{if(!drag)return;yaw-=(e.clientX-drag.x)*0.004;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-drag.y)*0.004));drag={x:e.clientX,y:e.clientY};draw();};
    const up=()=>{drag=null;};
    const key=(e:KeyboardEvent)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();yaw+=(e.key==='ArrowRight'?0.1:e.key==='ArrowLeft'?-0.1:0);pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.key==='ArrowUp'?0.1:e.key==='ArrowDown'?-0.1:0)));draw();};
    el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('keydown',key);
    const resize=new ResizeObserver(draw);resize.observe(el);
    return()=>{disposed=true;resize.disconnect();el.removeEventListener('pointerdown',down);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);el.removeEventListener('keydown',key);gl.deleteTexture(texture);gl.deleteBuffer(buffer);shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);};
  },[url]);
  return failed?<img src={url} alt="Развёртка панорамы" className="flat-panorama"/>:<canvas ref={canvas} className="viewer" tabIndex={0} aria-label="Панорама 360 градусов. Проведите пальцем или используйте стрелки для осмотра."/>;
}
