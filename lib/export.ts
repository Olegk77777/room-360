import { zipSync, strToU8 } from 'fflate';
import type { Shot } from './storage';

export async function decode(blob:Blob):Promise<HTMLImageElement>{
  const url=URL.createObjectURL(blob);const image=new Image();
  try {image.src=url;await image.decode();return image;}finally{URL.revokeObjectURL(url);}
}
export function canvasBlob(canvas:HTMLCanvasElement,quality=0.94):Promise<Blob>{
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось сохранить изображение')),'image/jpeg',quality));
}
export async function stitch(shots:Shot[],hfov:number,onProgress:(n:number)=>void):Promise<{blob:Blob;missing:number}>{
  const worker=new Worker(new URL('./stitch.worker.ts',import.meta.url),{type:'module'});
  const width=3072,height=1536;
  const exchange=(data:unknown,transfer:Transferable[]=[])=>new Promise<{type:string;message?:string;pixels:Uint8ClampedArray<ArrayBuffer>;missing:number}>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Сборка заняла слишком долго. Исходники сохранены. Попробуйте снова.')),90000);
    worker.onmessage=({data})=>{clearTimeout(timeout);if(data.type==='error')reject(new Error(data.message));else resolve(data);};
    worker.onerror=(e)=>{clearTimeout(timeout);reject(new Error(e.message||'Не удалось запустить сборку'));};
    worker.postMessage(data,transfer);
  });
  try{
    await exchange({type:'init',width});
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('Браузер не поддерживает обработку изображения');
    for(let i=0;i<shots.length;i++){
      const shot=shots[i],img=await decode(shot.blob),scale=Math.min(1,1280/Math.max(img.width,img.height));
      canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const actualFov=2*Math.atan(Math.tan(hfov*Math.PI/360)*Math.max(1,canvas.width/canvas.height))*180/Math.PI;
      await exchange({type:'shot',shot:{pixels,width:canvas.width,height:canvas.height,pose:shot.pose,hfov:actualFov}},[pixels.buffer]);
      onProgress((i+1)/(shots.length+1)*100);
    }
    const result=await exchange({type:'finish'});canvas.width=width;canvas.height=height;
    ctx.putImageData(new ImageData(result.pixels,width,height),0,0);
    const blob=await canvasBlob(canvas);onProgress(100);
    return {blob:await addPanoramaMetadata(blob,width,height),missing:result.missing};
  }finally{worker.terminate();}
}
export async function addPanoramaMetadata(blob:Blob,width:number,height:number):Promise<Blob>{
  // Стандартный XMP APP1: приложения могут распознать сферу 2:1.
  const xml=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True" GPano:FullPanoWidthPixels="${width}" GPano:FullPanoHeightPixels="${height}" GPano:CroppedAreaImageWidthPixels="${width}" GPano:CroppedAreaImageHeightPixels="${height}" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/></rdf:RDF></x:xmpmeta>`;
  const payload=strToU8('http://ns.adobe.com/xap/1.0/\0'+xml),size=payload.length+2;
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(bytes[0]!==255||bytes[1]!==216)throw new Error('Некорректный JPEG');
  return new Blob([bytes.slice(0,2),new Uint8Array([255,225,size>>8,size&255]),payload,bytes.slice(2)],{type:'image/jpeg'});
}
export async function exportSources(shots:Shot[]):Promise<Blob>{
  const files:Record<string,Uint8Array>={};
  for(const shot of shots)files[`frame-${String(shot.id+1).padStart(2,'0')}.jpg`]=new Uint8Array(await shot.blob.arrayBuffer());
  files['capture.json']=strToU8(JSON.stringify({app:'Room 360',version:1,projection:'equirectangular',coordinateSystem:'X right, Y forward, Z up; columns right/up/forward',shots:shots.map(({blob:_blob,...shot})=>({...shot,file:`frame-${String(shot.id+1).padStart(2,'0')}.jpg`}))},null,2));
  files['README.txt']=strToU8('Исходные кадры Room 360. capture.json содержит ориентацию камеры и приблизительный угол обзора. Кадры можно сшить в Hugin или другом панорамном редакторе. Фотографии не передавались на сервер.');
  return new Blob([zipSync(files,{level:0}) as Uint8Array<ArrayBuffer>],{type:'application/zip'});
}
export function download(blob:Blob,name:string){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
