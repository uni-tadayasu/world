// Navigation describes the virtual character's position, never a continuously
// tracked device. Geographic coordinates remain in this page's memory.
const directions=['北','北東','東','南東','南','南西','西','北西'];
export function headingFromYaw(yaw=0){
  const degrees=((-yaw*180/Math.PI)%360+360)%360;
  return {degrees,label:directions[Math.round(degrees/45)%8]};
}
export function nearestStreet(roads=[],x=0,z=0,maxDistance=35){
  let best=null,distance=maxDistance;
  for(const road of roads){if(!road.name)continue;for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
    const t=den?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/den)):0;
    const d=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);
    if(d<distance){best=road;distance=d;}
  }}
  return best?{name:best.name,distance,id:best.id}:null;
}
export function getNavigationState(world,{x=0,z=0,yaw=0,speed=0}={}){
  const heading=headingFromYaw(yaw),coordinates=world?.real?world.toGeo(x,z):null;
  return {coordinates,heading,street:nearestStreet(world?.mapFeatures?.roads,x,z),speedKmh:Math.max(0,speed)*3.6};
}
export function rebaseLocation(previous,next,point){
  if(!previous?.toGeo||!next?.toLocal)return null;
  const geo=previous.toGeo(point.x,point.z),p=next.toLocal(geo.latitude,geo.longitude);
  if(!Number.isFinite(p.x)||!Number.isFinite(p.z))return null;
  const b=next.bounds;
  if(b&&(p.x<b.minX+.5||p.x>b.maxX-.5||p.z<b.minZ+.5||p.z>b.maxZ-.5))return null;
  return p;
}
