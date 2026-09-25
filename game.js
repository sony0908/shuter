import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const $ = (q) => document.querySelector(q);
const ui = { canvas: $('#game'), welcome: $('#welcome'), deploy: $('#deploy'), quality: $('#qualitybutton'), qualityLabel: $('#quality'), objective: $('#objective'), health: $('#health'), healthBar: $('#healthbar'), ammo: $('#ammo'), enemies: $('#enemies'), hit: $('#hit'), notice: $('#notice') };
const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = false;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#76808a'); scene.fog = new THREE.FogExp2('#78828a', .026);
const camera = new THREE.PerspectiveCamera(72, 1, .08, 45); scene.add(camera);
const player = new THREE.Group(); player.position.set(0, 0, 20); scene.add(player);
const loader = new GLTFLoader(), clock = new THREE.Clock(), raycaster = new THREE.Raycaster();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);
const keys = new Set(), templates = new Map(), enemies = [], mixers = [], blocks = [];
const game = { live: false, ready: false, health: 150, maxHealth: 150, ammo: 30, reserve: 120, reloading: false, lastShot: 0, noticeTime: 0, quality: 0, yaw: 0, pitch: -.13, round: 0, waveTimer: null, recoil: 0 };
const profiles = [{ name: 'BAJA', ratio: .75, far: 45, shadows: false }, { name: 'MEDIA', ratio: 1, far: 65, shadows: true }, { name: 'ALTA', ratio: 1.35, far: 90, shadows: true }];

function texture(path, repeat) { const t = new THREE.TextureLoader().load(path); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); return t; }
const concrete = texture('/assets/textures/hangar-concrete-1k.jpg', [12, 12]);
const rustyMetal = texture('/assets/textures/rusty-metal-1k.jpg', [5, 2]);
function mat(color, map) { const options = { color, roughness: .82, metalness: .08 }; if (map) options.map = map; return new THREE.MeshStandardMaterial(options); }
function cube(size, pos, opts = {}) { const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(opts.color || '#6f746f', opts.map)); m.position.set(...pos); m.castShadow = m.receiveShadow = true; scene.add(m); if (opts.block !== false) blocks.push(new THREE.Box3().setFromObject(m)); return m; }
function world() {
  // Base floor - mirage provides detailed geometry, this is fallback
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), mat('#aaa8a0', concrete)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // Old procedural walls removed - replaced by mirage.glb (22MB optimized, draco+webp)
  // Keep minimal collision blocks for mirage to generate from GLB meshes
}
let sun;
function light() { scene.add(new THREE.HemisphereLight('#9caeb8','#252a25',2.1)); sun = new THREE.DirectionalLight('#ffe0ad',2.6); sun.position.set(-22,29,10); sun.castShadow = true; sun.shadow.camera.left=-30; sun.shadow.camera.right=30; sun.shadow.camera.top=30; sun.shadow.camera.bottom=-30; scene.add(sun); const spot = new THREE.SpotLight('#e3bc72',160,28,.68,.45,1.3); spot.position.set(0,9,-8); spot.target.position.set(0,0,-4); scene.add(spot,spot.target); }
async function load(name, path) { const g = await loader.loadAsync(path); g.scene.traverse((c) => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; if (c.material.map) c.material.map.colorSpace = THREE.SRGBColorSpace; } }); templates.set(name, { root:g.scene, clips:g.animations }); }
function fit(o, h) { const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3()); o.scale.multiplyScalar(h / Math.max(s.y,.001)); o.position.y -= new THREE.Box3().setFromObject(o).min.y; }
function instance(name, pos, height, rot = 0) { const t=templates.get(name); if (!t) return null; const o=cloneSkinned(t.root); fit(o,height); o.position.add(new THREE.Vector3(...pos)); o.rotation.y=rot; scene.add(o); return o; }
async function assets() {
  // Load character/weapon templates (keep) + mirage map (replaces old industrial yard)
  await Promise.all([
    ['rifle','player-rifle.glb'],['player','player.glb'],['zombie','zombie.glb'],
    ['crate','crate.glb'],['barrel','barrel.glb'] // keep minimal cover props
  ].map(([n,f])=>load(n,`/assets/models/${f}`)));
  // Load optimized mirage (22MB draco+webp) - replaces old world cubes and fence/container props
  const mirage = await loader.loadAsync('/assets/models/mirage.glb');
  mirage.scene.traverse((c)=>{ if(c.isMesh){ c.castShadow = c.receiveShadow = true; if(c.material.map) c.material.map.colorSpace = THREE.SRGBColorSpace; }});
  // Center mirage on X/Z, keep Y so floor aligns with player feet
  const box = new THREE.Box3().setFromObject(mirage.scene);
  const center = box.getCenter(new THREE.Vector3());
  mirage.scene.position.x -= center.x;
  mirage.scene.position.z -= center.z;
  // Lift so lowest point is at y=0.1 (avoid z-fighting), player will be placed on floor
  mirage.scene.position.y = -box.min.y + 0.1;
  scene.add(mirage.scene);
  // Place player on mirage floor (was below map)
  player.position.set(0, mirage.scene.position.y + 1.6, 20);
  // Use only local vertical meshes as blockers. The map floor and large combined meshes
  // have an X/Z box covering the entire arena, which would otherwise trap the player.
  let c = 0; mirage.scene.traverse((o)=>{ if(o.isMesh && c++ % 3 === 0){ const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3()); const isSolidProp = s.y > .8 && s.y < 10 && s.x < 14 && s.z < 14; if(isSolidProp) blocks.push(b); }});
  // Minimal cover props (kept, old container/fence/street/car/pipes removed - replaced by mirage)
  [[-8,-20],[15,5],[26,-16]].forEach(([x,z])=>instance('barrel',[x,0,z],1));
  [[-20,10],[10,-18],[25,9]].forEach(([x,z])=>instance('crate',[x,0,z],1.1,Math.random()*Math.PI));
  const soldier = instance('player',[0,0,0],1.76); soldier.position.set(0,0,0); soldier.visible = false; player.add(soldier);
  weapon=instance('rifle',[0,0,0],.34); weapon.position.set(.28,-.29,-.5); weapon.rotation.set(-.08,Math.PI/2,.02); camera.add(weapon);
  // Adjust spawn points for larger mirage arena
  game.ready = true; spawnWave(); hud();
}
let weapon;
function enemy(x,z,n) { const t=templates.get('zombie'), model=cloneSkinned(t.root); fit(model,1.78); const y = player.position.y - 1.6 + 0.05; model.position.set(x,y,z); const e={model,health:100 + game.round * 9,cooldown:0,speed:1.05+n*.035+game.round*.025,live:true,deadFor:null,mixer:null,clips:t.clips,action:null}; model.traverse(c=>{if(c.isMesh)c.userData.enemy=e}); scene.add(model); if(t.clips.length){const m=new THREE.AnimationMixer(model);e.mixer=m;mixers.push(m);enemyAction(e,'Walk')} enemies.push(e); }
function spawnWave() { game.round++; const count = 4 + game.round * 2; const points = [[-28,-20],[28,-20],[-29,18],[28,18],[-8,-23],[10,-23],[-29,0],[29,0],[-18,10],[20,10]]; for(let i=0;i<count;i++){const p=points[i%points.length]; enemy(p[0]+(Math.random()-.5)*3,p[1]+(Math.random()-.5)*3,i)} game.reserve=Math.min(999,game.reserve+90); game.health=Math.min(game.maxHealth,game.health+24); game.waveTimer=null; ui.objective.textContent=`Ronda ${game.round}: resiste la horda`; notify(`RONDA ${game.round}`,2.5); hud(); }
function enemyAction(enemy, name, once = false) { const clip = enemy.clips.find((item) => item.name.includes(name)); if (!clip || !enemy.mixer) return; const next = enemy.mixer.clipAction(clip); if (enemy.action !== next) { next.reset(); next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity); next.clampWhenFinished = once; next.fadeIn(.12).play(); if (enemy.action) enemy.action.fadeOut(.12); enemy.action = next; } }
function notify(text, seconds=1.4) { ui.notice.textContent=text; ui.notice.classList.add('show'); game.noticeTime=seconds; }
function hud() { ui.health.textContent=Math.ceil(Math.max(0,game.health)); ui.healthBar.style.width=`${Math.max(0,game.health / game.maxHealth * 100)}%`; ui.healthBar.style.background=game.health<45?'#d66554':'#b7c98a'; ui.ammo.textContent=`${game.ammo} / ${game.reserve}`; ui.enemies.textContent=`ENEMIGOS ${enemies.filter(e=>e.live).length}`; }
function shoot() { if(!game.live||game.reloading)return; const n=performance.now(); if(n-game.lastShot<110)return; if(!game.ammo)return reload(); game.lastShot=n;game.ammo--;game.recoil=.075;raycaster.setFromCamera(new THREE.Vector2(),camera); const hit=raycaster.intersectObjects(enemies.filter(e=>e.live).map(e=>e.model),true)[0]; if(hit){let o=hit.object;while(o&&!o.userData.enemy)o=o.parent;if(o?.userData.enemy){const e=o.userData.enemy;e.health-=34;enemyAction(e,e.health<=0?'Die':'Hit_reaction',e.health<=0);ui.hit.classList.add('show');setTimeout(()=>ui.hit.classList.remove('show'),80);if(e.health<=0)e.live=false}}hud(); }
function reload(){if(game.reloading||game.ammo===30||!game.reserve)return;game.reloading=true;notify('RECARGANDO...',1.1);setTimeout(()=>{const a=Math.min(30-game.ammo,game.reserve);game.ammo+=a;game.reserve-=a;game.reloading=false;hud()},1100)}
function canMove(p){if(Math.abs(p.x)>32.15||p.z>25.15||p.z<-25.15)return false;const radius=.38;return !blocks.some(b=>p.x+radius>b.min.x&&p.x-radius<b.max.x&&p.z+radius>b.min.z&&p.z-radius<b.max.z);}
function playerUpdate(dt){if(!game.live)return;const d=new THREE.Vector3(),f=new THREE.Vector3(-Math.sin(game.yaw),0,-Math.cos(game.yaw)),r=new THREE.Vector3(Math.cos(game.yaw),0,-Math.sin(game.yaw)),forward=keys.has('KeyW')||keys.has('ArrowUp'),back=keys.has('KeyS')||keys.has('ArrowDown'),left=keys.has('KeyA')||keys.has('ArrowLeft'),right=keys.has('KeyD')||keys.has('ArrowRight'),speed=(keys.has('ShiftLeft')||keys.has('ShiftRight'))?7.2:4.3;if(forward)d.add(f);if(back)d.sub(f);if(left)d.sub(r);if(right)d.add(r);if(d.lengthSq()){d.normalize().multiplyScalar(speed*dt);const xStep=player.position.clone();xStep.x+=d.x;if(canMove(xStep))player.position.x=xStep.x;const zStep=player.position.clone();zStep.z+=d.z;if(canMove(zStep))player.position.z=zStep.z}player.rotation.y=game.yaw;}
function followCamera(){camera.position.copy(player.position).add(new THREE.Vector3(0,1.56,0));const forward=new THREE.Vector3(-Math.sin(game.yaw),0,-Math.cos(game.yaw));const target=player.position.clone().add(forward.multiplyScalar(10));target.y+=1.56+Math.sin(game.pitch)*8;camera.lookAt(target);}
function ai(dt){for(const e of enemies){if(!e.live){if(e.deadFor!==null)e.deadFor+=dt;continue}const v=new THREE.Vector3().subVectors(player.position,e.model.position);v.y=0;const dis=v.length();e.model.lookAt(player.position.x,e.model.position.y,player.position.z);if(dis>5.2)e.model.position.add(v.normalize().multiplyScalar(e.speed*dt));e.cooldown-=dt;if(dis<10&&e.cooldown<0){e.cooldown=2.2+Math.random()*.8;enemyAction(e,'Attack');setTimeout(()=>e.live&&enemyAction(e,'Walk'),450);game.health-=3+Math.random()*3;if(game.health<=0){game.health=0;game.live=false;document.exitPointerLock();notify('MISIÓN FALLIDA',5)}}}hud()}
function waves(dt){if(!game.ready)return; for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];if(!e.live&&e.deadFor===null)e.deadFor=0;if(e.deadFor>25){scene.remove(e.model);enemies.splice(i,1)}} if(!enemies.some(e=>e.live)){if(game.waveTimer===null){game.waveTimer=60;ui.objective.textContent='Zona limpia: siguiente horda en 60 s';notify('SIGUIENTE HORDA EN 60',3)}else{game.waveTimer-=dt;const seconds=Math.max(0,Math.ceil(game.waveTimer));ui.objective.textContent=`Zona limpia: siguiente horda en ${seconds} s`;if(game.waveTimer<=0)spawnWave()}}}
function weaponSway(dt){if(!weapon)return;game.recoil=Math.max(0,game.recoil-dt*.5);weapon.position.set(.28,-.29,-.5+game.recoil);weapon.rotation.set(-.08-game.recoil*.7,Math.PI/2,.02);}
function quality(){const p=profiles[game.quality];renderer.setPixelRatio(Math.min(devicePixelRatio,p.ratio));renderer.shadowMap.enabled=p.shadows;camera.far=p.far;camera.updateProjectionMatrix();scene.fog.density=game.quality===0?.026:.018;ui.quality.textContent=p.name[0]+p.name.slice(1).toLowerCase();ui.qualityLabel.textContent=`CALIDAD: ${p.name}`;}
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}
function loop(){const dt=Math.min(clock.getDelta(),.05);if(game.live){playerUpdate(dt);ai(dt);waves(dt);mixers.forEach(m=>m.update(dt))}followCamera();weaponSway(dt);if(game.noticeTime>0&&!(game.noticeTime-=dt))ui.notice.classList.remove('show');renderer.render(scene,camera);requestAnimationFrame(loop)}
ui.deploy.onclick=()=>ui.canvas.requestPointerLock();document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement===ui.canvas){game.live=true;ui.welcome.classList.add('hide');notify('OBJETIVO ACTUALIZADO')}else{keys.clear();if(game.health>0){game.live=false;ui.welcome.classList.remove('hide')}}});addEventListener('mousemove',e=>{if(document.pointerLockElement===ui.canvas){game.yaw-=e.movementX*.0024;game.pitch=Math.max(-.5,Math.min(.32,game.pitch-e.movementY*.0018))}});const movementCodes=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);document.addEventListener('keydown',e=>{if(movementCodes.has(e.code)){e.preventDefault();keys.add(e.code)}if(e.code==='KeyR'){e.preventDefault();reload()}},{capture:true});document.addEventListener('keyup',e=>{if(movementCodes.has(e.code))e.preventDefault();keys.delete(e.code)},{capture:true});addEventListener('blur',()=>keys.clear());addEventListener('mousedown',e=>{if(e.button===0)shoot()});ui.quality.onclick=()=>{game.quality=(game.quality+1)%profiles.length;quality()};addEventListener('resize',resize);
world();light();resize();quality();hud();assets().catch(e=>{console.error(e);notify('NO SE PUDIERON CARGAR LOS RECURSOS',4)});loop();
