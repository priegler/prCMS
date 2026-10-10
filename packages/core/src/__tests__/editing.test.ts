import { describe, it, expect } from 'vitest';
import { scanSource } from '../source.js';
import { patchSource } from '../patcher.js';
import { resolveEdit } from '../resolver.js';
import { prepareEdits } from '../edit.js';
import { configWith } from '../config.js';
import { revision } from '../sinks/fs.js';
import type { Sink } from '../types.js';
import { scanAstro } from '../astro.js';
const config = configWith({ include: ['**/*.{tsx,ts,json,astro}'] });
export function memory(files: Record<string, string>): Sink {
  return { async list() { return Object.keys(files); }, async read(path) { if (!(path in files)) throw new Error('Missing source'); return { content: files[path], rev: revision(files[path]) }; }, async write() { return { committed: false }; } };
}
describe('source-first patching', () => {
  it.each([
    ['jsx', 'const Page = () => <p>\n  Hello &amp; world\n</p>;', 'Hello & world', 'Quotes " \' { } < > & 🚀'],
    ['string', "const text = 'Hello'; // untouched", 'Hello', "It\'s \\\\ a \"quote\"\n🚀"],
    ['string', 'const text = "Hello";', 'Hello', "A \'single\' and \"double\" \\ quote\n"],
    ['template', 'const text = `Hello`;', 'Hello', 'Use `${notCode}` and \\ paths 🚀'],
    ['json', '{"greeting": "Hello", "keep": "same"}', 'Hello', 'A "quote" and \nnewline 🚀'],
  ])('round-trips %s without reprinting surrounding code', async (kind, code, old, replacement) => {
    const path = kind === 'json' ? 'messages/en.json' : 'app/page.tsx';
    const file = { content: code, rev: 'rev' };
    const candidate = scanSource(path, file).candidates.find(c => c.value.trim() === old)!;
    expect(candidate).toBeDefined();
    const result = await patchSource(path, code, [{ candidate, newText: replacement }]);
    expect(result.content.startsWith(code.slice(0, candidate.start))).toBe(true);
    expect(result.content.endsWith(code.slice(candidate.end))).toBe(true);
    const after = scanSource(path, { content: result.content, rev: 'new' }).candidates.find(c => c.start === candidate.start)!;
    expect(after.value.trim()).toBe(replacement.trim());
    expect(result.diff).toContain('@@');
  });
  it('retains JSX indentation and encodes an attribute without introducing markup', async () => {
    const code = 'const Page = () => <img alt="A &amp; B" />;';
    const candidate = scanSource('app/page.tsx', { content: code, rev: 'r' }).candidates[0];
    const result = await patchSource(candidate.path, code, [{ candidate, newText: 'A "quote" <tag> {braces}' }]);
    expect(result.content).toContain('alt="A &quot;quote&quot; &lt;tag&gt; &#123;braces&#125;"');
    expect(scanSource(candidate.path, { content: result.content, rev: 'n' }).candidates[0].value).toBe('A "quote" <tag> {braces}');
  });
  it('does not treat JS-expression attributes as HTML strings', async () => {
    const code = "const Page = () => <img alt={'A'} />;";
    const candidate = scanSource('app/page.tsx', { content: code, rev: 'r' }).candidates[0];
    const result = await patchSource(candidate.path, code, [{ candidate, newText: "It's <nice>" }]);
    expect(result.content).toContain("alt={'It\\'s <nice>'}");
  });
  it('preserves original boundary whitespace once when editing DOM text', async () => {
    const code = 'const Page = () => <p>\n  Hello <strong>people</strong> today\n</p>;';
    const candidate = scanSource('app/page.tsx', { content: code, rev: 'r' }).candidates[0];
    const result = await patchSource(candidate.path, code, [{ candidate, newText: '  Good morning 🚀 ' }]);
    expect(result.content).toBe('const Page = () => <p>\n  Good morning 🚀 <strong>people</strong> today\n</p>;');
  });
  it('rejects overlapping edits', async () => {
    const code = 'const s = "Hi";';
    const c = scanSource('content/text.ts', { content: code, rev: 'r' }).candidates[0];
    await expect(patchSource(c.path, code, [{ candidate: c, newText: 'One' }, { candidate: c, newText: 'Two' }])).rejects.toThrow('Overlapping');
  });
  it('patches Astro text, attributes, expressions and frontmatter after emoji', async () => {
    const code = '---\nconst text = "Data copy";\n---\n<p>🚀 Hello</p><img alt="Photo"/><h1>{"Literal"}</h1>';
    const path = 'src/pages/index.astro';
    const scan = await scanAstro(path, { content: code, rev: 'r' });
    for (const old of ['Data copy', '🚀 Hello', 'Photo', 'Literal']) {
      const candidate = scan.candidates.find(c => c.value === old)!;
      expect(candidate, old).toBeDefined();
      const result = await patchSource(path, code, [{ candidate, newText: 'New <copy> {x}' }]);
      const after = await scanAstro(path, { content: result.content, rev: 'n' });
      expect(after.candidates.some(c => c.value === 'New <copy> {x}' || c.value === 'New &lt;copy&gt; &#123;x&#125;')).toBe(true);
    }
  });
});
describe('resolver and batching', () => {
  it('uses the direct locator to disambiguate identical leaf text', async () => {
    const code = 'export default () => <main><p>Buy</p><p>Buy</p></main>';
    const sink = memory({ 'app/page.tsx': code });
    const result = await resolveEdit(sink, config, { src: `app/page.tsx:1:${code.indexOf('<p>') + 1}`, oldText: 'Buy', newText: 'Go' });
    expect(result.status).toBe('resolved');
  });
  it('searches import dependencies two levels deep', async () => {
    const sink = memory({ 'app/page.tsx': 'import {items} from "../content/items"; export default () => <h1>{items[0]}</h1>;', 'content/items.ts': 'export { items } from "./copy";', 'content/copy.ts': 'export const items = ["Agent-made copy"];' });
    const result = await resolveEdit(sink, config, { src: 'app/page.tsx:1:60', oldText: 'Agent-made copy', newText: 'New' });
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') expect(result.candidate.path).toBe('content/copy.ts');
  });
  it('finds children props in callers and locale JSON outside the clicked component', async () => {
    const sink = memory({ 'components/Button.tsx': 'export const Button = ({children}) => <button>{children}</button>;', 'app/page.tsx': 'export default () => <Button>Start here</Button>;', 'messages/en.json': '{"title":"Welcome"}', 'messages/de.json': '{"title":"Welcome"}' });
    expect((await resolveEdit(sink, config, { src: 'components/Button.tsx:1:38', oldText: 'Start here', newText: 'Go' })).status).toBe('resolved');
    const locale = await resolveEdit(sink, config, { src: 'components/Button.tsx:1:38', oldText: 'Welcome', newText: 'Hello', locale: 'en' });
    expect(locale.status).toBe('resolved');
    if (locale.status === 'resolved') expect(locale.candidate.path).toBe('messages/en.json');
  });
  it('keeps fallback searches in the requested text or attribute context', async () => {
    const source = 'const copy="Welcome"; export default () => <img className="Welcome" title="Welcome" alt={"Welcome"} />;';
    const sink = memory({ 'app/page.tsx': source });
    const text = await resolveEdit(sink, config, { src: 'app/page.tsx:99:1', oldText: 'Welcome', newText: 'Hello' });
    expect(text.status).toBe('resolved');
    if (text.status === 'resolved') expect(text.candidate.raw).toBe('"Welcome"');
    const changes = await prepareEdits(sink, config, [{ src: 'app/page.tsx:99:1', oldText: 'Welcome', newText: '<Hello> & "quote"', attribute: 'alt' }]);
    expect(changes[0].content).toContain(String.raw`alt={"<Hello> & \"quote\""}`);
    expect(changes[0].content).toContain('title="Welcome"');
    expect((await resolveEdit(memory({ 'app/page.tsx': 'const copy="Welcome"; export default () => <p className="Welcome">{dynamic}</p>;' }), config, { src: 'app/page.tsx:99:1', oldText: 'Welcome', newText: 'Hello', attribute: 'alt' })).status).toBe('unresolved');
    expect((await resolveEdit(memory({ 'app/page.tsx': 'export default () => <p className="Welcome">{dynamic}</p>;' }), config, { src: 'app/page.tsx:99:1', oldText: 'Welcome', newText: 'Hello' })).status).toBe('unresolved');
  });
  it('returns ambiguous matches and validates a selected candidate', async () => {
    const sink = memory({ 'app/page.tsx': 'const texts = ["Same", "Same"]; export default () => <p>{texts[0]}</p>;' });
    const edit = { src: 'app/page.tsx:1:50', oldText: 'Same', newText: 'Different' };
    const result = await resolveEdit(sink, config, edit); expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') throw new Error('Expected ambiguity');
    const selected = result.candidates[1];
    const changes = await prepareEdits(sink, config, [{ ...edit, candidateId: selected.id, baseRev: selected.baseRev }]);
    expect(changes[0].content).toContain('["Same", "Different"]');
  });
  it('re-resolves changed source but refuses a duplicate introduced at the old location', async () => {
    const old = 'export default () => <p>Hello</p>;';
    const sink = memory({ 'app/page.tsx': '\n' + old });
    const edit = { src: 'app/page.tsx:1:22', oldText: 'Hello', newText: 'New', baseRev: revision(old) };
    const changes = await prepareEdits(sink, config, [edit]); expect(changes[0].content).toBe('\nexport default () => <p>New</p>;');
    const duplicate = memory({ 'app/page.tsx': 'export default () => <p>Hello</p>; const other = "Hello";' });
    expect((await resolveEdit(duplicate, config, edit)).status).toBe('ambiguous');
  });
  it('relocates a preview-pinned candidate after source offsets change', async () => {
    const old = 'export default () => <p>Hello</p>;';
    const candidate = scanSource('app/page.tsx', { content: old, rev: revision(old) }).candidates[0];
    const edit = { src: 'app/page.tsx:1:22', oldText: 'Hello', newText: 'New', baseRev: candidate.baseRev, candidateId: candidate.id };
    const changes = await prepareEdits(memory({ 'app/page.tsx': '\n' + old }), config, [edit]);
    expect(changes[0].content).toBe('\nexport default () => <p>New</p>;');
    expect((await resolveEdit(memory({ 'app/page.tsx': '\n' + old + ' const other="Hello";' }), config, edit)).status).toBe('ambiguous');
  });
  it('indexes mixed text around elements and safely rejects uncertain runtime indices', async () => {
    const code = 'export default () => <p>Same {show ? <strong>x</strong> : null} Same</p>;';
    const result = await resolveEdit(memory({ 'app/page.tsx': code }), config, { src: 'app/page.tsx:1:22', oldText: 'Same', newText: 'Second', textNodeIndex: 1 });
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') expect(result.candidate.raw).toBe(' Same');
    for (const expression of ['show && <strong>x</strong>', 'dynamicCopy', '<>Same</>']) {
      const uncertain = code.replace('show ? <strong>x</strong> : null', expression);
      expect((await resolveEdit(memory({ 'app/page.tsx': uncertain }), config, { src: 'app/page.tsx:1:22', oldText: 'Same', newText: 'Second', textNodeIndex: 1 })).status).toBe('ambiguous');
    }
  });
  it('batches source edits against original offsets', async () => {
    const sink = memory({ 'app/page.tsx': 'export default () => <main><h1>Title</h1><p>Body</p></main>;' });
    const changes = await prepareEdits(sink, config, [{ src: 'app/page.tsx:1:1', oldText: 'Title', newText: 'A much longer title' }, { src: 'app/page.tsx:1:1', oldText: 'Body', newText: 'Copy' }]);
    expect(changes).toHaveLength(1); expect(changes[0].content).toContain('<h1>A much longer title</h1><p>Copy</p>');
  });
  it('does not match JSON property names or import specifiers', async () => {
    const sink = memory({ 'app/page.tsx': 'import x from "Buy"; export default () => <p>{x}</p>;', 'messages/en.json': '{"Buy":"Something else"}' });
    expect((await resolveEdit(sink, config, { src: 'app/page.tsx:1:1', oldText: 'Buy', newText: 'Hi' })).status).toBe('unresolved');
  });
  it('refuses traversal and out-of-scope sources', async () => {
    const sink = memory({ 'app/page.tsx': 'const text = "Hi";' });
    await expect(resolveEdit(sink, config, { src: '../.env:1:1', oldText: 'Hi', newText: 'Bye' })).rejects.toThrow('scope');
  });
});
