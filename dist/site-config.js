// Both the custom hostname and the managed hostname serve the same Worker.
// Keep API/session requests on the page's own origin; browser cookies must never
// be copied across domains. GitHub Pages only supplies the redirecting entrance.
export const PUBLIC_ORIGIN='https://www.omoji-z.com';
export const NATIVE_ORIGIN='https://machi-life.hisa-0128-1996.chatgpt.site';
const ONLINE_HOSTS=new Set([PUBLIC_ORIGIN,NATIVE_ORIGIN]);
export const isOnlineHost=(origin=globalThis.location?.origin)=>ONLINE_HOSTS.has(origin);
export const getOnlineOrigin=()=>isOnlineHost()?globalThis.location.origin:NATIVE_ORIGIN;
