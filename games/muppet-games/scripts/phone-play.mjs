import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPhoneServer } from '../server/phone.js';

const port=Number(process.env.PHONE_PORT||8790);
const server=createPhoneServer({port,publicUrl:process.env.PHONE_PUBLIC_URL||''});
await server.listen();
console.log(`Felt Fairway: http://127.0.0.1:${port}/golf.html`);
let tunnel=null,stopping=false;
async function stop(){if(stopping)return;stopping=true;tunnel?.kill('SIGTERM');await server.close();}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
if(!process.argv.includes('--local')&&!process.env.PHONE_PUBLIC_URL){
  const bundled=fileURLToPath(new URL('../.tools/cloudflared',import.meta.url));
  const binary=process.env.CLOUDFLARED||(existsSync(bundled)?bundled:'cloudflared');
  tunnel=spawn(binary,['tunnel','--url',`http://127.0.0.1:${port}`,'--no-autoupdate','--protocol','http2'],{stdio:['ignore','pipe','pipe']});
  let announced=false,buffer='';
  const output=data=>{
    buffer=(buffer+data.toString()).slice(-12000);
    const url=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if(url&&!announced){announced=true;server.setPublicUrl(url[0]);console.log(`Secure phone link ready: ${url[0]}/golf.html`);console.log('Open the local range on your computer and scan its QR code. Keep this process running.');}
    const line=data.toString();if(/ERR|error|failed/i.test(line))process.stderr.write(line);
  };
  tunnel.stdout.on('data',output);tunnel.stderr.on('data',output);
  tunnel.on('error',error=>console.error(`Tunnel unavailable: ${error.message}. Install cloudflared, set CLOUDFLARED, or supply PHONE_PUBLIC_URL.`));
  tunnel.on('exit',code=>{if(!stopping){server.setPublicUrl('');console.error(`Secure tunnel stopped (${code}). Local mouse practice remains available. Restart npm run phone for phone play.`);}});
}else if(process.env.PHONE_PUBLIC_URL){console.log(`Using secure public address: ${process.env.PHONE_PUBLIC_URL}`);}
else console.log('Local test mode. Motion on a phone requires a trusted HTTPS address.');
