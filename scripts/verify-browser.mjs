import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../packages/core/package.json', import.meta.url));
const { chromium } = require('playwright');
const demoRoot = fileURLToPath(new URL('../demo', import.meta.url));
import { readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const [mode = 'production', base = 'http://localhost:3310', root = demoRoot] = process.argv.slice(2);
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
try {
 const page = await browser.newPage(); const errors=[]; page.on('pageerror', e => errors.push(e.message));page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
 const scripts=[]; page.on('response', response => {if(response.url().includes('/_next/static/') && response.url().endsWith('.js')) scripts.push(response);});
 await page.goto(base + (mode==='production'?'':'/?cms=edit'),{waitUntil:'networkidle'});
 if (mode==='production') {
  assert.equal(await page.locator('[data-src]').count(),0);assert.equal(await page.locator('[data-inlinecms-ui]').count(),0);
  assert.equal((await page.request.get(base+'/api/cms/auth')).status(),404);
  const contents=await Promise.all(scripts.map(s=>s.text()));assert(!contents.some(s=>s.includes('InlineCMS pending changes')||s.includes('inlinecms-session')||s.includes('EditorOverlay')));
  console.log(JSON.stringify({mode,locators:0,editor:0,apiStatus:404,cmsBytesLoaded:0,errors}));
 } else {
  await page.getByLabel('CMS secret').fill(process.env.INLINECMS_TEST_SECRET ?? 'dummy');await page.getByRole('button',{name:'Login',exact:true}).click();
  await page.getByRole('complementary',{name:'InlineCMS pending changes'}).waitFor();
  const count=await page.locator('[data-src]').count(); assert(count>20);assert((await page.locator('main > header h1').getAttribute('data-src')).startsWith('app/page.tsx:'));
  assert((await page.locator('main > header button').getAttribute('data-src')).startsWith('components/Button.tsx:'));
  if (mode==='locators') {assert(!errors.some(e=>/hydration|hydrated|did not match/i.test(e)));console.log(JSON.stringify({mode,locators:count,errors}));}
  else {
   const originals = new Map();for(const path of ['app/page.tsx','content/features.ts']) originals.set(path,await readFile(root+'/'+path,'utf8'));
   const uploaded = [];
   try {
    await page.locator('main > header h1').click();await page.getByRole('button',{name:'Edit text inline'}).click();
    await page.locator('main > header h1').fill('A source-first browser edit.');
    await page.getByRole('textbox',{name:'Ask AI',exact:true}).click();
    await page.getByText('1 pending change',{exact:false}).waitFor();assert((await readFile(root+'/app/page.tsx','utf8')).includes('Your website, in your own words.'));
    await page.getByRole('button',{name:'Revert',exact:true}).click();assert.equal(await page.locator('main > header h1').textContent(),'Your website, in your own words.');
    await page.getByRole('button',{name:'Edit text inline'}).click();await page.locator('main > header h1').fill('A source-first browser edit.');await page.getByRole('textbox',{name:'Ask AI',exact:true}).click();
    await page.getByText('1 pending change',{exact:false}).waitFor();await page.getByRole('button',{name:'Publish',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Written to source'}).waitFor();assert((await readFile(root+'/app/page.tsx','utf8')).includes('<h1 style={{ fontSize: 48, letterSpacing: \'-2px\' }}>A source-first browser edit.</h1>'));
    await page.reload({waitUntil:'networkidle'});await page.locator('article h3').first().click();await page.getByRole('button',{name:'Edit text inline'}).click();await page.locator('article h3').first().fill('Edited data array title');await page.getByRole('textbox',{name:'Ask AI',exact:true}).click();
    await page.getByText('content/features.ts',{exact:true}).waitFor();await page.getByRole('button',{name:'Publish',exact:true}).click();await page.getByRole('status').filter({hasText:'Written to source'}).waitFor();assert((await readFile(root+'/content/features.ts','utf8')).includes('Edited data array title'));
    await page.reload({waitUntil:'networkidle'});
    await page.locator('main img').click();
    const altLabel = page.getByLabel('Element editor').locator('label').filter({hasText:/^alt/});
    await altLabel.locator('input').fill('A browser attribute preview');await altLabel.getByRole('button',{name:'Preview attribute'}).click();
    await page.getByText('1 pending change',{exact:false}).waitFor();assert.equal(await page.locator('main img').getAttribute('alt'),'A browser attribute preview');
    await page.getByRole('button',{name:'Revert',exact:true}).click();assert.equal(await page.locator('main img').getAttribute('alt'),'A bright desk ready for your next idea');
    await page.locator('main p').filter({hasText:'curious people'}).click();
    const fragment = page.getByLabel('Element editor').locator('label').filter({hasText:'Text fragment 1'});
    await fragment.locator('textarea').fill('Good morning ');await fragment.getByRole('button',{name:'Preview fragment'}).click();
    await page.getByText('1 pending change',{exact:false}).waitFor();assert.equal(await page.locator('main strong').textContent(),'curious people');
    await page.getByRole('button',{name:'Revert',exact:true}).click();assert((await page.locator('main p').filter({hasText:'curious people'}).textContent()).startsWith('Hello '));
    await page.locator('main > header button').click();await page.getByRole('button',{name:'Edit text inline'}).click();await page.locator('main > header button').fill('Edited children prop');await page.getByRole('textbox',{name:'Ask AI',exact:true}).click();
    await page.getByText('1 pending change',{exact:false}).waitFor();await page.getByRole('button',{name:'Publish',exact:true}).click();await page.getByRole('status').filter({hasText:'Written to source'}).waitFor();assert((await readFile(root+'/app/page.tsx','utf8')).includes('<Button>Edited children prop</Button>'));
    await page.reload({waitUntil:'networkidle'});await page.locator('main img').click();
    const imageResponse = page.waitForResponse(r=>r.url().endsWith('/api/cms/image') && r.status()===200);
    await page.getByLabel('Replace image').setInputFiles({name:'preview.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc9sAAAAASUVORK5CYII=','base64')});
    const upload = await (await imageResponse).json();uploaded.push(root+'/public'+upload.src);
    await page.getByText('2 pending changes',{exact:false}).waitFor();assert((await page.locator('main img').getAttribute('src')).startsWith('blob:'));
    await page.getByRole('button',{name:'Revert',exact:true}).last().click();
    await page.getByText('0 pending changes',{exact:false}).waitFor();assert.equal(await page.locator('main img').getAttribute('src'),'/workspace.svg');
    await page.getByLabel('Replace image').setInputFiles([]);
    const secondImageResponse = page.waitForResponse(r=>r.url().endsWith('/api/cms/image') && r.status()===200);
    await page.getByLabel('Replace image').setInputFiles({name:'preview.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc9sAAAAASUVORK5CYII=','base64')});
    const secondUpload = await (await secondImageResponse).json();uploaded.push(root+'/public'+secondUpload.src);
    await page.getByText('2 pending changes',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Publish',exact:true}).click();await page.getByRole('status').filter({hasText:'Written to source'}).waitFor();assert((await readFile(root+'/app/page.tsx','utf8')).includes(secondUpload.src));assert((await readFile(uploaded[1])).length>0);
    assert(!errors.some(e=>/hydration|hydrated|did not match/i.test(e)));
    console.log(JSON.stringify({mode,locators:count,inlinePreview:true,revert:true,sourcePublish:true,dataArrayPublish:true,attributes:true,mixedFragments:true,childrenProps:true,imagePublish:true,imageRevert:true,errors}));
   } finally {for(const [path,content] of originals) await writeFile(root+'/'+path,content);for(const path of uploaded) await unlink(path).catch(()=>{});await rmdir(root+'/public/inlinecms').catch(()=>{});}
  }
 }
} finally {await browser.close();}
