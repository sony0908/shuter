// Worker para Perímetro Industrial - offload colisiones y navegación (fase 2)
let groundTris = [], wallTris = [];
let groundSamples = new Map(), wallSamples = new Map();

function rayTriIntersect(orig, dir, v0, v1, v2) {
  const e1 = [v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]];
  const e2 = [v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]];
  const h = [dir[1]*e2[2]-dir[2]*e2[1], dir[2]*e2[0]-dir[0]*e2[2], dir[0]*e2[1]-dir[1]*e2[0]];
  const a = e1[0]*h[0]+e1[1]*h[1]+e1[2]*h[2];
  if (a > -1e-6 && a < 1e-6) return null;
  const f = 1/a;
  const s = [orig[0]-v0[0], orig[1]-v0[1], orig[2]-v0[2]];
  const u = f*(s[0]*h[0]+s[1]*h[1]+s[2]*h[2]);
  if (u<0 || u>1) return null;
  const q = [s[1]*e1[2]-s[2]*e1[1], s[2]*e1[0]-s[0]*e1[2], s[0]*e1[1]-s[1]*e1[0]];
  const v = f*(dir[0]*q[0]+dir[1]*q[1]+dir[2]*q[2]);
  if (v<0 || u+v>1) return null;
  const t = f*(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2]);
  return t>1e-6 ? t : null;
}

self.onmessage = (e) => {
  const {type, id, data} = e.data;
  if (type === 'init') {
    groundTris = data.groundTris || [];
    wallTris = data.wallTris || [];
    groundSamples.clear(); wallSamples.clear();
    self.postMessage({type:'inited'});
  } else if (type === 'groundAt') {
    const {x,z,referenceY,depth} = data;
    const key = `${Math.round(x*4)},${Math.round(z*4)},${Math.round(referenceY*2)},${Math.round(depth)}`;
    if (groundSamples.has(key)) { self.postMessage({type:'groundAt', id, y: groundSamples.get(key)}); return; }
    const origin = [x, referenceY+0.7, z];
    const dir = [0,-1,0];
    let best = null;
    for (const tri of groundTris) {
      const t = rayTriIntersect(origin, dir, tri.v0, tri.v1, tri.v2);
      if (t!==null && t < depth) {
        const y = origin[1] - t;
        if (y <= referenceY+0.5 && y >= referenceY-depth && tri.normal[1] > 0.45) {
          if (best===null || y > best) best = y;
        }
      }
    }
    const y = best!==null ? best+0.03 : referenceY;
    if (groundSamples.size>2400) groundSamples.clear();
    groundSamples.set(key,y);
    self.postMessage({type:'groundAt', id, y});
  } else if (type === 'wallCheck') {
    const {from,to} = data;
    const travel = [to[0]-from[0],0,to[2]-from[2]];
    const dist = Math.hypot(travel[0],travel[2]);
    if (!dist || !wallTris.length) { self.postMessage({type:'wallCheck', id, blocked:false}); return; }
    const key = `${Math.round(from[0]*3)},${Math.round(from[2]*3)},${Math.round(to[0]*3)},${Math.round(to[2]*3)},${Math.round(from[1]*2)}`;
    if (wallSamples.has(key)) { self.postMessage({type:'wallCheck', id, blocked: wallSamples.get(key)}); return; }
    const len = Math.hypot(travel[0],travel[2]); travel[0]/=len; travel[2]/=len;
    const side = [-travel[2]*0.24,0,travel[0]*0.24];
    let blocked=false;
    outer: for (const offset of [[0,0,0], side, [-side[0],0,-side[2]]]) {
      const origin = [from[0]+offset[0], from[1]+0.82, from[2]+offset[2]];
      for (const tri of wallTris) {
        if (Math.abs(tri.normal[1]) >= 0.65) continue;
        const t = rayTriIntersect(origin, [travel[0],0,travel[2]], tri.v0, tri.v1, tri.v2);
        if (t!==null && t < dist+0.42) { blocked=true; break outer; }
      }
    }
    if (wallSamples.size>1800) wallSamples.clear();
    wallSamples.set(key,blocked);
    self.postMessage({type:'wallCheck', id, blocked});
  }
};
