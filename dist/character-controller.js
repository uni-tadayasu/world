// Feet are expressed in world metres. Only explicitly registered walking surfaces
// are queried; furniture, roofs and decorative meshes never become a floor.
export function createCharacterController({sampleGround,isBlocked=()=>false,radius=.32,maxStep=.35,maxSlopeDegrees=50,gravity=18,jumpSpeed=5.4,snapDown=.22}={}){
  if(typeof sampleGround!=='function')throw new TypeError('sampleGround is required');
  const slopeLimit=Math.cos(maxSlopeDegrees*Math.PI/180),skin=.002;
  const state={x:0,y:0,z:0,grounded:false,verticalVelocity:0,groundHeight:null,support:null,speed:0,distance:0,landed:false,jumped:false};
  let lastSafe={x:0,y:0,z:0};
  function sample(x,z){
    const ground=sampleGround(x,z);
    if(!ground||!Number.isFinite(ground.height))return null;
    return ground;
  }
  function walkable(ground){return ground&&(ground.normal?.y??1)>=slopeLimit;}
  function reset({x=0,y,z=0}={}){
    state.x=Number.isFinite(x)?x:0;state.z=Number.isFinite(z)?z:0;
    const ground=sample(state.x,state.z);
    state.y=Number.isFinite(y)?y:(ground?.height??0);
    state.grounded=Boolean(walkable(ground)&&Math.abs(state.y-ground.height)<.03);
    if(state.grounded)state.y=ground.height;
    state.verticalVelocity=0;state.support=ground;state.groundHeight=ground?.height??null;
    state.speed=state.distance=0;state.landed=state.jumped=false;
    lastSafe={x:state.x,y:state.y,z:state.z};return state;
  }
  function advance(x,z){
    if(isBlocked(x,z,radius))return false;
    const ground=sample(x,z);
    if(ground){
      const rise=ground.height-state.y;
      if(state.grounded){
        if(rise>maxStep+skin||!walkable(ground))return false;
        if(rise>=-snapDown){state.y=ground.height;state.support=ground;}
        else state.grounded=false;
      }else if(rise>skin){
        // A jump can clear a ledge only once the feet are above it.
        return false;
      }
    }else state.grounded=false;
    state.x=x;state.z=z;return true;
  }
  function step(dt,{dx=0,dz=0,jump=false}={}){
    state.speed=state.distance=0;state.landed=state.jumped=false;
    if(!Number.isFinite(dt)||dt<=0)return state;
    dt=Math.min(dt,.1);dx=Number.isFinite(dx)?dx:0;dz=Number.isFinite(dz)?dz:0;
    if(jump&&state.grounded){state.grounded=false;state.verticalVelocity=jumpSpeed;state.jumped=true;}
    const count=Math.max(1,Math.ceil(dt/(1/120)),Math.ceil(Math.hypot(dx,dz)/(radius*.45))),h=dt/count;
    let travelled=0;
    for(let i=0;i<count;i++){
      if(!state.grounded){state.verticalVelocity-=gravity*h;state.y+=state.verticalVelocity*h;}
      const x=state.x,z=state.z;
      // Try the diagonal first to avoid axis-dependent slope speed; slide along
      // a wall if only one component is obstructed.
      if(!advance(x+dx/count,z+dz/count)){
        if(dx)advance(state.x+dx/count,state.z);
        if(dz)advance(state.x,state.z+dz/count);
      }
      travelled+=Math.hypot(state.x-x,state.z-z);
      const ground=sample(state.x,state.z);state.support=ground;state.groundHeight=ground?.height??null;
      if(ground&&walkable(ground)){
        if(state.grounded&&Math.abs(state.y-ground.height)<=maxStep+skin){state.y=ground.height;state.verticalVelocity=0;}
        else if(state.verticalVelocity<=0&&state.y<=ground.height+skin){
          state.landed=!state.grounded;state.y=ground.height;state.verticalVelocity=0;state.grounded=true;
        }
        if(state.grounded)lastSafe={x:state.x,y:state.y,z:state.z};
      }else state.grounded=false;
      if(state.y<lastSafe.y-30){reset(lastSafe);break;}
    }
    state.distance=travelled;state.speed=travelled/dt;return state;
  }
  return {state,reset,step};
}
