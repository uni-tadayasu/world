export function installInteractionGuard(){
  const editable=target=>target instanceof Element&&!!target.closest('input,textarea,[contenteditable="true"]');
  const stop=event=>event.preventDefault();
  document.addEventListener('contextmenu',stop,{capture:true});
  document.addEventListener('dblclick',stop,{capture:true});
  document.addEventListener('dragstart',event=>{if(!editable(event.target))event.preventDefault();},{capture:true});
  document.addEventListener('selectstart',event=>{if(!editable(event.target))event.preventDefault();},{capture:true});
  for(const name of ['gesturestart','gesturechange','gestureend'])document.addEventListener(name,stop,{passive:false});
  document.addEventListener('touchmove',event=>{if(event.touches.length>1)event.preventDefault();},{passive:false});
  let lastTouch=0,lastTarget=null;
  document.addEventListener('touchend',event=>{const now=performance.now();if(!editable(event.target)&&event.target===lastTarget&&now-lastTouch<320)event.preventDefault();lastTouch=now;lastTarget=event.target;},{passive:false});
}
