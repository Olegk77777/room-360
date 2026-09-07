import { accumulate, finishPixels } from './geometry.mjs';
const worker = self as unknown as {postMessage:(data:unknown,transfer?:Transferable[])=>void;onmessage:((event:MessageEvent)=>void)|null};
let sums:Float32Array, weights:Float32Array, width:number, height:number;
worker.onmessage=({data})=>{
  try {
    if(data.type==='init'){
      width=data.width;height=width/2;sums=new Float32Array(width*height*3);weights=new Float32Array(width*height);
      worker.postMessage({type:'ready'});
    } else if(data.type==='shot'){
      accumulate(sums,weights,width,height,data.shot);worker.postMessage({type:'next'});
    } else if(data.type==='finish'){
      const result=finishPixels(sums,weights);worker.postMessage({type:'done',...result},[result.pixels.buffer]);
    }
  }catch(error){worker.postMessage({type:'error',message:error instanceof Error?error.message:'Не удалось собрать панораму'});}
};
