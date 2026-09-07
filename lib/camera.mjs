export function cameraConstraints(id='') {
  return {audio:false,video:{...(id?{deviceId:{exact:id}}:{facingMode:{ideal:'environment'}}),width:{ideal:1440},height:{ideal:1920},aspectRatio:{ideal:0.75},frameRate:{ideal:30,max:30}}};
}
export function cameraPose(pose,facing='environment') {
  // Поток передней камеры не зеркалим: меняется направление её оптической оси.
  if(facing!=='user')return pose;
  return {right:pose.right.map(v=>-v),up:pose.up,forward:pose.forward.map(v=>-v)};
}
