const esbuild = require('esbuild');
const fs = require('node:fs');
async function main() {
  await esbuild.build({entryPoints:['ui/script-editor.js'],bundle:true,minify:true,format:'iife',outfile:'ui/monaco-editor.js',loader:{'.ttf':'file'},assetNames:'monaco-[name]'});
  for (const [entry,name] of [['node_modules/monaco-editor/esm/vs/editor/editor.worker.js','worker'],['ui/script-editor-worker.js','typescript-worker']]) {
    await esbuild.build({entryPoints:[entry],bundle:true,minify:true,format:'iife',outfile:`ui/monaco-${name}.js`});
  }
  fs.copyFileSync('node_modules/monaco-editor/LICENSE','ui/monaco-LICENSE.txt');
  fs.copyFileSync('node_modules/monaco-editor/ThirdPartyNotices.txt','ui/monaco-ThirdPartyNotices.txt');
  fs.copyFileSync('node_modules/dompurify/LICENSE','ui/monaco-DOMPurify-LICENSE.txt');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
