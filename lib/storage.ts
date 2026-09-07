export type Pose = {right:number[];up:number[];forward:number[]};
export type Shot = {id:number;blob:Blob;pose:Pose;hfov:number;width:number;height:number;created:number;manual:boolean;cameraId?:string;cameraLabel?:string;facingMode?:string};
let connection:Promise<IDBDatabase>|undefined;
function db(){
  return connection??=new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('room360',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('shots',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function loadShots():Promise<Shot[]>{
  const database=await db();return new Promise((resolve,reject)=>{
    const req=database.transaction('shots').objectStore('shots').getAll();
    req.onsuccess=()=>resolve(req.result.sort((a:Shot,b:Shot)=>a.id-b.id));req.onerror=()=>reject(req.error);
  });
}
export async function storeShot(shot:Shot){
  const database=await db();return new Promise<void>((resolve,reject)=>{
    const tx=database.transaction('shots','readwrite');tx.objectStore('shots').put(shot);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export async function removeShot(id:number){
  const database=await db();return new Promise<void>((resolve,reject)=>{
    const tx=database.transaction('shots','readwrite');tx.objectStore('shots').delete(id);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export async function clearShots(){
  const database=await db();return new Promise<void>((resolve,reject)=>{
    const tx=database.transaction('shots','readwrite');tx.objectStore('shots').clear();
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
