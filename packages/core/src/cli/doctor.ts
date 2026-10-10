import { resolveEdit } from '../resolver.js';
import { normalizeText } from '../normalize.js';
import type { InlineCMSConfig } from '../config.js';
import type { Sink } from '../types.js';
export interface VisibleText { src: string; text: string; attribute?: string; textNodeIndex?: number }
export async function scoreEditability(sink: Sink, config: InlineCMSConfig, nodes: VisibleText[]) {
  let editable = 0;
  const offenders: { src: string; text: string; reason: string }[] = [];
  for (const node of nodes) {
    try {
      const result = await resolveEdit(sink, config, { src: node.src, oldText: node.text, newText: node.text, attribute: node.attribute, textNodeIndex: node.textNodeIndex });
      if (result.status === 'resolved') editable++; else offenders.push({ src: node.src, text: node.text, reason: result.status });
    } catch (error) { offenders.push({ src: node.src, text: node.text, reason: (error as Error).message }); }
  }
  return { total: nodes.length, editable, score: nodes.length ? Math.round(1000 * editable / nodes.length) / 10 : 0, offenders };
}
export async function doctor(sink: Sink, config: InlineCMSConfig, baseUrl: string) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const pages = [];
    for (const route of config.routes) {
      const page = await browser.newPage();
      await page.goto(new URL(route, baseUrl).href, { waitUntil: 'networkidle' });
      const nodes: VisibleText[] = await page.evaluate(() => {
        const found: { src: string; text: string; textNodeIndex?: number; attribute?: string }[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode, parent = node.parentElement;
          if (!parent || !node.textContent?.trim() || parent.closest('script,style,noscript,[data-inlinecms-ui]')) continue;
          if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
          const el = parent.closest<HTMLElement>('[data-src]');
          const directTexts = el ? [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) : [];
          found.push({ src: el?.dataset.src ?? '(no locator)', text: node.textContent, textNodeIndex: el === parent && parent.children.length ? directTexts.indexOf(node as ChildNode) : undefined });
        }
        for (const el of document.querySelectorAll<HTMLElement>('[data-src]')) {
          if (!el.checkVisibility()) continue;
          for (const attribute of ['alt', 'title', 'placeholder', 'aria-label']) if (el.getAttribute(attribute)?.trim()) found.push({ src: el.dataset.src!, text: el.getAttribute(attribute)!, attribute });
        }
        return found;
      });
      const texts = nodes.filter(node => !node.attribute && normalizeText(node.text));
      pages.push({ route, ...await scoreEditability(sink, config, texts), attributes: await scoreEditability(sink, config, nodes.filter(n => n.attribute)) });
      await page.close();
    }
    const total = pages.reduce((n, p) => n + p.total, 0), editable = pages.reduce((n, p) => n + p.editable, 0);
    return { score: total ? Math.round(1000 * editable / total) / 10 : 0, total, editable, pages };
  } finally { await browser.close(); }
}
