import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, CircleHelp, Download, Expand, Focus, Globe2, LoaderCircle, Pause, Play, RotateCcw, Settings2, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { viewfinderGuide } from '@/lib/guidance.mjs';
import { cameraConstraints, cameraPose } from '@/lib/camera.mjs';
import { TARGETS, angles, angularDistance, basis, clamp, rotateHeading, sensorPose, wrap } from '@/lib/geometry.mjs';
import { clearShots, loadShots, removeShot, storeShot, type Pose, type Shot } from '@/lib/storage';
import { canvasBlob, download, exportSources, stitch } from '@/lib/export';
import { Viewer } from './viewer';

type Screen='home'|'capture'|'review';
type OrientationAPI=typeof DeviceOrientationEvent & {requestPermission?:()=>Promise<string>};
const emptyGuide={x:0,y:0,offscreen:false,arrow:0,distance:180,hold:0,live:false,hint:'Ожидаем датчики…',aligned:false};

function CaptureMap({count}:{count:number}){
  return <div className="capture-map" aria-label={`Снято ${count} из ${TARGETS.length} направлений`}>
    {[['Потолок',[22]],['Верх',Array.from({length:10},(_,i)=>12+i)],['Стены',Array.from({length:12},(_,i)=>i)],['Низ',Array.from({length:10},(_,i)=>23+i)],['Пол',[33]]].map(([name,ids])=><div className="map-row" key={String(name)}><span>{name}</span><div>{(ids as number[]).map(id=><i key={id} className={id<count?'taken':id===count?'current':''} title={TARGETS[id].label}/>)}</div></div>)}
  </div>;
}

export default function App(){
  const [screen,setScreen]=useState<Screen>('home'),[shots,setShots]=useState<Shot[]>([]),[loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[help,setHelp]=useState(false);
  const [running,setRunning]=useState(false),[paused,setPaused]=useState(false),[calibrated,setCalibrated]=useState(false);
  const [manual,setManual]=useState(false),[auto,setAuto]=useState(true),[guide,setGuide]=useState(emptyGuide),[sensorAvailable,setSensorAvailable]=useState(false);
  const [progress,setProgress]=useState(0),[result,setResult]=useState<{blob:Blob;url:string;missing:number}|null>(null),[hfov,setHfov]=useState(48);
  const [videoSize,setVideoSize]=useState({width:3,height:4}),[frameSize,setFrameSize]=useState({width:300,height:400});
  const [cameraOptions,setCameraOptions]=useState<MediaDeviceInfo[]>([]),[cameraId,setCameraId]=useState(()=>{try{return localStorage.getItem('room360-camera')??'';}catch{return '';}});
  const [cameraLabel,setCameraLabel]=useState('Задняя камера'),[panel,setPanel]=useState<'camera'|'settings'|null>(null);
  const facing=useRef('environment');
  const [showReset,setShowReset]=useState(false),[saving,setSaving]=useState(false);
  const video=useRef<HTMLVideoElement>(null),frame=useRef<HTMLDivElement>(null),stream=useRef<MediaStream|null>(null);
  const sensor=useRef<{pose:Pose;time:number;speed:number}|null>(null),origin=useRef(0),hold=useRef(0),taking=useRef(false),lastShot=useRef(0);
  const shotsRef=useRef(shots),stateRef=useRef({running,paused,calibrated,manual,auto,hfov});
  const wake=useRef<WakeLockSentinel|null>(null),startGeneration=useRef(0),buildActive=useRef(false);
  useEffect(()=>{shotsRef.current=shots;stateRef.current={running,paused,calibrated,manual,auto,hfov};});
  const target=TARGETS[shots.length];
  const stopCamera=useCallback(()=>{startGeneration.current++;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setRunning(false);hold.current=0;void wake.current?.release().catch(()=>{});wake.current=null;},[]);
  useEffect(()=>{
    loadShots().then(s=>{setShots(s);if(s[0]?.cameraId)setCameraId(s[0].cameraId);if(s.length)setNote('Черновик восстановлен на этом устройстве.');}).catch(()=>setNote('Браузер не разрешил хранить черновик. Снимки будут доступны до закрытия страницы.')).finally(()=>setLoaded(true));
    return()=>{stream.current?.getTracks().forEach(t=>t.stop());void wake.current?.release().catch(()=>{});};
  },[]);
  useEffect(()=>{
    const onOrientation=(e:DeviceOrientationEvent)=>{
      if(e.alpha===null||e.beta===null||e.gamma===null||![e.alpha,e.beta,e.gamma].every(Number.isFinite))return;
      const screenAngle=window.screen.orientation?.angle??(Reflect.get(window,'orientation') as number|undefined)??0;
      const pose=cameraPose(sensorPose(e.alpha,e.beta,e.gamma,screenAngle),facing.current),now=performance.now(),previous=sensor.current;
      const speed=previous?angularDistance(previous.pose.forward,pose.forward)/Math.max(0.01,(now-previous.time)/1000):0;
      sensor.current={pose,time:now,speed};setSensorAvailable(true);
    };
    const onVisibility=()=>{if(document.hidden){setPaused(true);hold.current=0;}};
    const onPageHide=()=>stopCamera();
    window.addEventListener('deviceorientation',onOrientation);document.addEventListener('visibilitychange',onVisibility);window.addEventListener('pagehide',onPageHide);
    return()=>{window.removeEventListener('deviceorientation',onOrientation);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pagehide',onPageHide);};
  },[stopCamera]);
  useEffect(()=>{
    if(!frame.current)return;const observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;setFrameSize({width:r.width,height:r.height});});observer.observe(frame.current);return()=>observer.disconnect();
  },[screen]);
  useEffect(()=>()=>{if(result)URL.revokeObjectURL(result.url);},[result]);
  const invalidateResult=()=>setResult(null);

  async function startCamera(useManual=false,selectedId=cameraId){
    if(busy)return;stateRef.current.running=false;setRunning(false);setBusy(true);setError('');setGuide(emptyGuide);sensor.current=null;setSensorAvailable(false);setManual(useManual);setCalibrated(false);setPaused(false);setPanel(null);setScreen('capture');
    const generation=++startGeneration.current;
    try{
      // На iPhone запрос разрешения должен оставаться внутри обработки нажатия.
      const api=window.DeviceOrientationEvent as OrientationAPI|undefined;
      const permission=!useManual&&api?.requestPermission?api.requestPermission():Promise.resolve('granted');
      const granted=await permission;
      if(granted!=='granted'){setManual(true);setNote('Доступ к движению запрещён. Можно снимать вручную по подсказкам.');}
      if(!window.isSecureContext)throw new Error('Камере нужна защищённая ссылка. Откройте приложение по HTTPS.');
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Здесь нет доступа к камере. Откройте ссылку в Safari или Chrome.');
      stream.current?.getTracks().forEach(t=>t.stop());
      const media=await navigator.mediaDevices.getUserMedia(cameraConstraints(selectedId));
      if(generation!==startGeneration.current){media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;
      const el=video.current;if(!el)throw new Error('Не удалось открыть видоискатель');el.srcObject=media;
      await el.play();
      if(!el.videoWidth)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Камера не передаёт изображение. Попробуйте ещё раз.')),10000);el.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});});
      if(generation!==startGeneration.current)return;
      setVideoSize({width:el.videoWidth,height:el.videoHeight});setRunning(true);
      const updateSize=()=>setVideoSize({width:el.videoWidth||3,height:el.videoHeight||4});el.onresize=updateSize;
      navigator.mediaDevices.enumerateDevices().then(devices=>setCameraOptions(devices.filter(d=>d.kind==='videoinput'))).catch(()=>{});
      const track=media.getVideoTracks()[0],settings=track.getSettings();
      facing.current=settings.facingMode??(/front|user|перед|фронт/i.test(track.label)?'user':'environment');
      sensor.current=null;setSensorAvailable(false);
      const actualId=settings.deviceId??selectedId;setCameraId(actualId);setCameraLabel(track.label||'Камера');
      try{localStorage.setItem('room360-camera',actualId);}catch{/* Съёмка работает и без запоминания выбора. */}
      track.addEventListener('mute',()=>{if(stream.current===media){setPaused(true);hold.current=0;}});
      track.addEventListener('ended',()=>{if(stream.current===media){setRunning(false);setError('Камера остановилась. Снимки сохранены — включите её снова.');}});
      if('wakeLock' in navigator)navigator.wakeLock.request('screen').then(lock=>{if(generation===startGeneration.current)wake.current=lock;else void lock.release();}).catch(()=>{});
    }catch(e){stopCamera();setError(e instanceof DOMException&&e.name==='NotAllowedError'?'Камера запрещена. Разрешите доступ в настройках этого сайта в Safari и нажмите «Включить камеру».':e instanceof DOMException&&e.name==='NotFoundError'?'Камера не найдена. Откройте эту ссылку на телефоне.':e instanceof DOMException&&e.name==='OverconstrainedError'?'Выбранная камера больше недоступна. Нажмите «Камера» и выберите другую.':e instanceof Error?e.message:'Не удалось включить камеру.');}
    finally{setBusy(false);}
  }
  function calibrate(){
    if(!manual&&(!sensor.current||performance.now()-sensor.current.time>800)){setError('Датчики пока не передают направление. Разрешите движение или выберите съёмку без датчиков.');return;}
    // При продолжении совмещаем камеру с последним сохранённым кадром.
    const previous=shotsRef.current.findLast(s=>Math.abs(angles(s.pose).pitch)<75),referenceYaw=previous?angles(previous.pose).yaw:0;
    if(sensor.current)origin.current=wrap(angles(sensor.current.pose).yaw-referenceYaw);
    setCalibrated(true);setError('');if(note==='Черновик восстановлен на этом устройстве.')setNote('');hold.current=0;lastShot.current=performance.now();
  }
  const capture=useCallback(async()=>{
    const state=stateRef.current,el=video.current,index=shotsRef.current.length;
    if(taking.current||!state.running||state.paused||!state.calibrated||!el||el.readyState<2||index>=TARGETS.length||document.hidden)return;
    const current=sensor.current;
    if(el.paused||stream.current?.getVideoTracks()[0]?.muted)return;
    if(!state.manual&&(!current||performance.now()-current.time>800))return;
    taking.current=true;setSaving(true);hold.current=0;
    try{
      const canvas=document.createElement('canvas'),scale=Math.min(1,1920/Math.max(el.videoWidth,el.videoHeight));
      canvas.width=Math.round(el.videoWidth*scale);canvas.height=Math.round(el.videoHeight*scale);
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось получить снимок');ctx.drawImage(el,0,0,canvas.width,canvas.height);
      const pose=state.manual?basis(TARGETS[index].yaw,TARGETS[index].pitch):rotateHeading(current!.pose,origin.current);
      const blob=await canvasBlob(canvas,0.95);
      const shot:Shot={id:index,blob,pose,hfov:2*Math.atan(Math.tan(state.hfov*Math.PI/360)*Math.max(1,canvas.width/canvas.height))*180/Math.PI,width:canvas.width,height:canvas.height,created:Date.now(),manual:state.manual,cameraId:stream.current?.getVideoTracks()[0]?.getSettings().deviceId,cameraLabel:stream.current?.getVideoTracks()[0]?.label,facingMode:facing.current};
      try{await storeShot(shot);}catch{setNote('Не удалось записать черновик в память браузера. Не закрывайте страницу, скачайте исходники после съёмки.');}
      const next=[...shotsRef.current,shot];shotsRef.current=next;setShots(next);setResult(null);lastShot.current=performance.now();navigator.vibrate?.(35);
      if(next.length===TARGETS.length){stopCamera();setScreen('review');}
    }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить кадр');setPaused(true);}
    finally{taking.current=false;setSaving(false);}
  },[stopCamera]);
  useEffect(()=>{
    if(!running)return;
    const timer=setInterval(()=>{
      const state=stateRef.current,target=TARGETS[shotsRef.current.length],now=performance.now(),current=sensor.current;
      if(!target)return;
      if(state.manual){setGuide({...emptyGuide,live:true,hint:target.label,aligned:true});return;}
      if(!current||now-current.time>800){hold.current=0;setGuide({...emptyGuide,hint:'Нет данных движения. Проверьте разрешение или снимайте вручную.'});return;}
      const pose=rotateHeading(current.pose,origin.current),a=angles(pose),distance=angularDistance(pose.forward,target.vector);
      const actualFov=2*Math.atan(Math.tan(state.hfov*Math.PI/360)*Math.max(1,videoSize.width/videoSize.height))*180/Math.PI;
      const point=viewfinderGuide(target.vector,pose,actualFov,videoSize.width,videoSize.height,frameSize.width,frameSize.height);
      const rollOkay=Math.abs(target.pitch)>80||angularDistance(pose.up,basis(a.yaw,a.pitch).up)<7;
      const aligned=distance<3.0&&rollOkay;
      const still=current.speed<7;
      if(!aligned||!still||video.current?.paused||stream.current?.getVideoTracks()[0]?.muted||state.paused||!state.calibrated||document.hidden||taking.current||now-lastShot.current<1200)hold.current=0;
      else if(!hold.current)hold.current=now;
      const fraction=hold.current?clamp((now-hold.current)/1100,0,1):0;

      let hint=aligned?(still?'Замрите на секунду':'Двигайтесь медленнее'):!rollOkay&&distance<6?'Выровняйте телефон':point.instruction;
      if(state.paused)hint='Съёмка на паузе';
      setGuide({x:point.x,y:point.y,offscreen:point.offscreen,arrow:point.arrow,distance,hold:fraction,live:true,hint,aligned});
      if(fraction>=1&&state.auto)void capture();
    },80);
    return()=>clearInterval(timer);
  },[running,videoSize,frameSize,capture]);

  async function makePanorama(){
    if(buildActive.current||!shots.length)return;buildActive.current=true;stopCamera();setScreen('review');setBusy(true);setError('');setProgress(0);
    try{const r=await stitch(shotsRef.current,hfov,setProgress);setResult({...r,url:URL.createObjectURL(r.blob)});}
    catch(e){setError(e instanceof Error?e.message:'Не удалось собрать панораму. Исходники доступны для скачивания.');}
    finally{setBusy(false);buildActive.current=false;}
  }
  async function saveSources(){
    setBusy(true);setError('');try{download(await exportSources(shotsRef.current),'room360-originals.zip');}catch{setError('Не удалось подготовить архив. Попробуйте ещё раз.');}finally{setBusy(false);}
  }
  async function undo(){
    if(taking.current)return;setPaused(true);const last=shotsRef.current.at(-1);if(!last)return;
    try{await removeShot(last.id);const next=shotsRef.current.slice(0,-1);shotsRef.current=next;setShots(next);invalidateResult();hold.current=0;}
    catch{setError('Не удалось убрать последний кадр из черновика. Попробуйте снова.');}
  }
  async function reset(){
    try{await clearShots();stopCamera();shotsRef.current=[];setShots([]);setResult(null);setScreen('home');setNote('');setError('');setShowReset(false);setCalibrated(false);}
    catch{setError('Не удалось очистить черновик. Закройте другие вкладки приложения и попробуйте снова.');}
  }
  async function share(){
    if(!result)return;
    const file=new File([result.blob],'room360.jpg',{type:'image/jpeg'});
    try{if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:'Room 360'});else download(result.blob,'room360.jpg');}
    catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))download(result.blob,'room360.jpg');}
  }
  function openPanel(next:'camera'|'settings'){if(busy||saving)return;hold.current=0;if(calibrated)setPaused(true);setPanel(next);}
  const currentStage=shots.length===34?'Готово':target?.ring??'Стены';

  return <main className={`app ${screen==='capture'?'camera-mode':''}`}>
    <header className="header"><button className="brand" onClick={()=>{if(busy||saving)return;stopCamera();setScreen('home');}} aria-label="На главный экран"><span className="brand-icon"><Focus size={21}/></span>room<span className="brand-number">360</span><span className="beta">BETA</span></button><button className="icon-button" aria-label="Как снимать" onClick={()=>setHelp(!help)}><CircleHelp size={21}/></button></header>
    {help&&<aside className="help-box"><button className="icon-button help-close" aria-label="Закрыть подсказку" onClick={()=>setHelp(false)}><X size={18}/></button><h2>Вращайте камеру, а не обходите комнату</h2><p>Встаньте ближе к центру. Держите объектив над одной точкой, поворачивая телефон вокруг него. Особенно важно рядом с мебелью.</p><p>Снимайте вертикально на основную заднюю камеру, без переключения объективов. Оставьте свет включённым и не двигайте предметы.</p><p>Safari на iPhone попросит доступ к камере и движению. Для значка на экране: «Поделиться» → «На экран Домой».</p></aside>}
    {error&&<div className="notice error" role="alert">{error}<button aria-label="Скрыть сообщение" onClick={()=>setError('')}><X size={18}/></button></div>}
    {note&&screen!=='capture'&&<output className="notice">{note}<button aria-label="Скрыть сообщение" onClick={()=>setNote('')}><X size={18}/></button></output>}

    {screen==='home'&&<div className="home-content">
      <div className="eyebrow"><span className="status-dot"/>ПАНОРАМА С ТЕЛЕФОНА</div>
      <h1>Вся комната.<br/><span>В одном кадре.</span></h1>
      <p className="intro">Наведите камеру на точки.<br/>Мы подскажем, куда повернуть.</p>
      <div className="orbit-diagram" aria-hidden="true"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="orbit orbit-c"/><div className="orbit-equator"/>{Array.from({length:8},(_,i)=><i className={`orbit-point point-${i}`} key={i}/>)}<div className="orbit-center"><Smartphone size={39} strokeWidth={1.2}/><span className="orbit-cross"/></div><span className="diagram-angle">360° × 180°</span></div>
      <div className="home-facts"><span><Focus size={17}/>34 точки</span><span><Globe2 size={17}/>Полная сфера</span></div>
      <Button className="primary-action" disabled={!loaded||busy} onClick={()=>shots.length===34?setScreen('review'):void startCamera()}>{busy?<LoaderCircle className="spin"/>:<Camera size={20}/>} {shots.length===34?'Открыть панораму':shots.length?`Продолжить · ${shots.length} / 34`:'Снять комнату'}<ArrowRight size={20}/></Button>
      {shots.length>0&&<div className="home-secondary"><Button variant="ghost" className="text-action" onClick={()=>{setScreen('review');}}>Открыть черновик</Button><Button variant="ghost" className="text-action" onClick={()=>setShowReset(true)}>Новая съёмка</Button></div>}
      <p className="privacy">Без регистрации. Фотографии остаются у вас.</p>
      <details className="small-details"><summary>Перед первой съёмкой</summary><p>Встаньте в центре комнаты. Телефон — вертикально. Объектив держите на одном месте, а корпус поворачивайте вокруг него. Начните со стены, затем снимите верх, потолок, низ и пол.</p><p>Это первая версия: сборка по датчикам может оставлять заметные стыки, особенно на близкой мебели. Сохраняйте исходники.</p></details>
    </div>}

    {screen==='capture'&&<section className="capture-content">
      <div className="capture-toolbar">
        <button className="hud-button" aria-label="Закрыть съёмку" disabled={busy||saving} onClick={()=>{stopCamera();setScreen(shots.length?'review':'home');}}><X size={21}/></button>
        <span className="capture-counter"><strong>{shots.length} / 34</strong><span>{currentStage}</span></span>
        <button className="hud-button camera-picker-button" disabled={busy||saving} onClick={()=>openPanel('camera')} aria-label="Выбрать камеру"><Camera size={19}/><span>Камера</span></button>
        <button className="hud-button" disabled={busy||saving} onClick={()=>openPanel('settings')} aria-label="Настройки съёмки"><Settings2 size={20}/></button>
      </div>
      <div ref={frame} className={`camera-frame ${guide.aligned&&calibrated?'is-aligned':''} ${saving?'flash':''}`}>
        <video ref={video} playsInline muted autoPlay aria-label="Изображение с камеры"/>
        <div className="camera-corners" aria-hidden="true"><i/><i/><i/><i/></div>
        {running&&calibrated&&!paused&&target&&<>

          <div className="crosshair" aria-hidden="true"><svg viewBox="0 0 88 88"><circle className="crosshair-track" cx="44" cy="44" r="34"/><circle className="crosshair-fill" cx="44" cy="44" r="34" strokeDasharray={`${guide.hold*214} 214`}/></svg><i/><b/></div>
          {!manual&&guide.live&&<div className={guide.offscreen?'edge-guide':'target-point'} style={{left:`calc(50% + ${guide.x}px)`,top:`calc(50% + ${guide.y}px)`}} aria-hidden="true">{guide.offscreen?<><ArrowRight size={26} style={{transform:`rotate(${guide.arrow}deg)`}}/><span>{Math.round(guide.distance)}°</span></>:guide.aligned?<Check size={18}/>:<span/>}</div>}
          <div className="camera-caption"><strong>{manual?target.label:guide.hint}</strong><span>{manual?`Поворот ${Math.round(target.yaw)}° · наклон ${target.pitch}°`:guide.offscreen?'Следуйте стрелке к следующей точке':guide.aligned?'Держите объектив на одном месте':target.label}</span></div>
        </>}
        {running&&!calibrated&&<div className="camera-overlay"><h2>{shots.length?'Вернёмся к съёмке':'Готовы снимать?'}</h2><p>{shots.length?'Наведите камеру точно как на опорном снимке ниже. Затем нажмите «Продолжить отсюда».':'Держите телефон вертикально и направьте его прямо на стену перед собой.'}</p>{!shots.length&&<button className="setup-camera-button" disabled={busy} onClick={()=>openPanel('camera')}><Camera size={20}/><span>{cameraLabel}<small>Выбрать другую камеру</small></span><ArrowRight size={18}/></button>}{shots.length>0&&<ShotPreview shot={shots.findLast(s=>Math.abs(angles(s.pose).pitch)<75)??shots[shots.length-1]}/>}<Button className="primary-action compact" onClick={calibrate} disabled={!manual&&!sensorAvailable}>{shots.length?'Продолжить отсюда':'Я готов'}</Button>{!sensorAvailable&&!manual&&<><p className="muted small">Ожидаем разрешение на движение…</p><button className="text-button" onClick={()=>{setManual(true);setNote('Без датчиков направления приблизительные. Автосъёмка отключена.');}}>Снимать без датчиков</button></>}</div>}
        {running&&paused&&calibrated&&<div className="camera-overlay"><Pause size={34}/><h2>Пауза</h2><p>Верните объектив на прежнее место и продолжайте.</p><Button className="primary-action compact" onClick={()=>{setPaused(false);hold.current=0;lastShot.current=performance.now();void video.current?.play().catch(()=>setError('Камера прервалась. Включите её заново.'));}}><Play size={18}/>Продолжить</Button></div>}
        {!running&&<div className="camera-overlay"><Camera size={40}/><h2>{busy?'Включаем камеру':'Камера выключена'}</h2><p>{busy?'Разрешите камеру и движение, когда браузер спросит.':'Разрешите камеру, чтобы видеть точки поверх изображения.'}</p>{busy?<LoaderCircle className="spin"/>:<Button className="primary-action compact" onClick={()=>void startCamera(manual)}>Включить камеру</Button>}</div>}
      </div>
      {note&&<output className="capture-note">{note}</output>}
      <div className="capture-controls"><button className="round-control" disabled={!shots.length||busy||saving} onClick={()=>void undo()} aria-label="Переснять последний кадр"><RotateCcw size={22}/><span>Переснять</span></button><button className={`shutter ${saving?'saving':''}`} aria-label="Снять кадр" disabled={!running||!calibrated||paused||saving||(!manual&&(!guide.aligned||!guide.live))} onClick={()=>void capture()}>{saving?<LoaderCircle className="spin" size={25}/>:<span/>}</button><button className="round-control" disabled={!running||!calibrated||saving} onClick={()=>{setPaused(!paused);hold.current=0;}} aria-label={paused?'Продолжить съёмку':'Пауза'}>{paused?<Play size={22}/>:<Pause size={22}/>}<span>{paused?'Дальше':'Пауза'}</span></button></div>
      <Sheet open={panel!==null} onOpenChange={open=>{if(!open)setPanel(null);}}>
        <SheetContent side="bottom" className="capture-sheet" showCloseButton={false}>
          <SheetHeader><SheetTitle>{panel==='camera'?'Выберите камеру':'Настройки съёмки'}</SheetTitle><SheetDescription>{panel==='camera'?(shots.length?'Камера закреплена до конца этой серии. Другую можно выбрать в новой съёмке.':'Нажмите на камеру и оцените изображение перед первым снимком.'):'После закрытия настроек нажмите «Продолжить».'}</SheetDescription></SheetHeader>
          <SheetClose className="sheet-close hud-button" aria-label="Закрыть настройки"><X size={21}/></SheetClose>
          {panel==='camera'?<div className="camera-list">
            {cameraOptions.map((d,i)=><Button variant="outline" className={`camera-option ${d.deviceId===cameraId?'selected':''}`} key={d.deviceId} disabled={busy||shots.length>0} onClick={()=>void startCamera(manual,d.deviceId)}><Camera size={20}/><span>{d.label||`Камера ${i+1}`}<small>{d.deviceId===cameraId?'Выбрана':'Посмотреть изображение'}</small></span>{d.deviceId===cameraId&&<Check size={20}/>}</Button>)}
            {!cameraOptions.length&&<p className="muted">Разрешите доступ к камере, чтобы браузер показал доступные объективы.</p>}
            <Button variant="outline" className="secondary-action" disabled={busy||shots.length>0} onClick={()=>void startCamera(manual,'')}>Задняя камера автоматически</Button>
            {cameraOptions.length===1&&<p className="muted">Браузер предоставил только одну камеру.</p>}
          </div>:<div className="capture-settings">
            <label className="auto-switch" htmlFor="auto-capture">Автоснимок при совмещении<Switch id="auto-capture" checked={auto&&!manual} disabled={manual} onCheckedChange={setAuto} aria-label="Автоматическая съёмка"/></label>
            <CaptureMap count={shots.length}/>
            <p>Держите объектив на одном месте. Если точка за кадром, следуйте стрелке у края экрана.</p>
            <button className="text-button" onClick={()=>{setManual(!manual);setCalibrated(false);setPaused(false);setPanel(null);hold.current=0;}}>{manual?'Включить наведение по датчикам':'Перейти на ручную съёмку'}</button>
          </div>}
        </SheetContent>
      </Sheet>
    </section>}

    {screen==='review'&&<section className="review-content"><div className="eyebrow"><span className="status-dot"/>{shots.length===34?'ВСЕ НАПРАВЛЕНИЯ СНЯТЫ':'СЪЁМКА СОХРАНЕНА'}</div><h1>Ваша комната<span className="green">.</span></h1><p className="intro">{shots.length} из 34 кадров{shots.length<34?' · можно продолжить съёмку':''}</p>
      {result?<div className="result-frame"><Viewer url={result.url}/><div className="viewer-label"><Expand size={16}/>Проведите пальцем, чтобы осмотреться</div></div>:<div className="review-placeholder">{busy?<><LoaderCircle size={38} className="spin"/><h2>Собираем панораму</h2><p>Оставьте страницу открытой.</p><Progress value={progress} aria-label="Сборка панорамы"/><span>{Math.round(progress)}%</span></>:<><Globe2 size={44} strokeWidth={1}/><h2>{shots.length===34?'Всё готово к сборке':'Черновик панорамы'}</h2><CaptureMap count={shots.length}/></>}</div>}
      {result&&<p className="result-note">{result.missing>0.005?`Около ${Math.round(result.missing*100)}% сферы не покрыто снимками. Тёмные участки — пропуски. `:''}Сборка по датчикам: стыки на близких предметах могут быть заметны.</p>}
      {!result&&<Button className="primary-action" disabled={busy||!shots.length} onClick={()=>void makePanorama()}><Globe2 size={20}/>{shots.length===34?'Собрать панораму':'Собрать черновик'}<ArrowRight size={20}/></Button>}
      {result&&<Button className="primary-action" onClick={()=>void share()}><Download size={20}/>Сохранить панораму<ArrowRight size={20}/></Button>}
      {shots.length<34&&<Button variant="outline" className="secondary-action" disabled={busy} onClick={()=>void startCamera()}><Camera size={19}/>Продолжить съёмку</Button>}
      <Button variant="ghost" className="secondary-action" disabled={busy||!shots.length} onClick={()=>void saveSources()}><Download size={18}/>Скачать исходники · ZIP</Button>
      <details className="small-details"><summary>Если стыки расходятся</summary><p>Браузер не сообщает точный угол объектива. Попробуйте изменить его и пересобрать панораму. Это не исправит смещение телефона во время съёмки.</p><p id="fov-label">Угол по короткой стороне · {hfov}°</p><Slider value={[hfov]} min={38} max={70} step={1} onValueChange={v=>setHfov(Array.isArray(v)?v[0]:v)} aria-labelledby="fov-label" disabled={busy}/><Button variant="outline" className="secondary-action" disabled={busy||!shots.length} onClick={()=>void makePanorama()}>Пересобрать</Button><p>JPEG 3072 × 1536, полная развёртка 2:1 с метаданными 360°. Исходники сохраняются отдельно и подходят для более точной сшивки в редакторе.</p></details>
      <button className="text-button new-capture" disabled={busy} onClick={()=>setShowReset(true)}>Новая съёмка</button>
    </section>}
    {showReset&&<ResetDialog onCancel={()=>setShowReset(false)} onReset={()=>void reset()}/>}
    <footer className="footer"><span>ROOM 360</span><span>v0.2 · на вашем устройстве</span></footer>
  </main>;
}

function ShotPreview({shot}:{shot:Shot}){
  const image=useRef<HTMLImageElement>(null);useEffect(()=>{const u=URL.createObjectURL(shot.blob);if(image.current)image.current.src=u;return()=>URL.revokeObjectURL(u);},[shot]);return <img ref={image} className="previous-shot" alt="Последний снятый кадр: совместите с ним направление камеры"/>;
}

import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
function ResetDialog({onCancel,onReset}:{onCancel:()=>void;onReset:()=>void}){
  return <AlertDialog open onOpenChange={open=>{if(!open)onCancel();}}><AlertDialogContent className="reset-dialog"><AlertDialogHeader><AlertDialogTitle>Начать новую съёмку?</AlertDialogTitle><AlertDialogDescription>Текущий черновик будет удалён с устройства. Сначала сохраните панораму или исходники, если они нужны.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={onCancel}>Оставить черновик</AlertDialogCancel><AlertDialogAction onClick={onReset}>Начать заново</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
