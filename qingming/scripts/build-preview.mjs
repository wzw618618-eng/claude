import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const result=await build({entryPoints:[path.join(root,'scripts/browser-preview.ts')],bundle:true,format:'iife',platform:'browser',write:false,minify:true,plugins:[{name:'raw-css',setup(b){b.onResolve({filter:/\.css\?raw$/},args=>({path:path.resolve(args.resolveDir,args.path.replace('?raw','')),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async args=>({contents:await fs.readFile(args.path,'utf8'),loader:'text'}));}}]});
const out=path.join(root,'visual-preview');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>青冥录</title></head><body><script>'+result.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');
console.log('Built visual-preview/index.html');
