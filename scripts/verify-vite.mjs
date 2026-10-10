import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const transformRequire = createRequire(new URL('../packages/transform/package.json', import.meta.url));
const coreRequire = createRequire(new URL('../packages/core/package.json', import.meta.url));
const { createServer, build } = await import(transformRequire.resolve('vite'));
const { default: react } = await import(transformRequire.resolve('@vitejs/plugin-react'));
const { chromium } = coreRequire('playwright');
import inlineCMS from '../packages/transform/dist/vite.js';
import { mkdtemp, mkdir, writeFile, symlink, readFile, readdir, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=await mkdtemp(join(tmpdir(), 'inlinecms-vite-'));
try {
 await mkdir(root+'/src');await symlink(fileURLToPath(new URL('../demo/node_modules', import.meta.url)),root+'/node_modules');
 await writeFile(root+'/index.html','<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
 await writeFile(root+'/src/main.tsx','import React from "react";import {createRoot} from "react-dom/client"; function Page(){return <main><h1>Vite source-first</h1><p>Client-rendered copy</p></main>}createRoot(document.getElementById("root")).render(<Page/>);');
 process.env.NODE_ENV='development';const server=await createServer({configFile:false,root,plugins:[inlineCMS({root}),react()],server:{host:'127.0.0.1',port:3313}});await server.listen();
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try {const page=await browser.newPage();await page.goto('http://127.0.0.1:3313',{waitUntil:'networkidle'});assert.equal(await page.locator('[data-src]').count(),3);assert((await page.locator('h1').getAttribute('data-src')).startsWith('src/main.tsx:'));console.log('Vite dev: 3 host locators');}finally{await browser.close();await server.close();}
 process.env.NODE_ENV='production';await build({configFile:false,root,plugins:[inlineCMS({root}),react()],logLevel:'error'});const files=await readdir(root+'/dist/assets');const js=await Promise.all(files.filter(f=>f.endsWith('.js')).map(f=>readFile(root+'/dist/assets/'+f,'utf8')));assert(!js.some(c=>c.includes('data-src')));console.log('Vite production: no locator attributes');
}finally{await rm(root,{recursive:true,force:true});}
