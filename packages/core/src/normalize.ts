import { decodeHTML } from 'entities';

/** React's JSX line folding; indentation around multiline children is not copy. */
export function normalizeJSXWhitespace(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let last = 0;
  lines.forEach((line, i) => { if (/[^ \t]/.test(line)) last = i; });
  return lines.map((line, i) => {
    let text = line.replace(/\t/g, ' ');
    if (i !== 0) text = text.replace(/^ +/, '');
    if (i !== lines.length - 1) text = text.replace(/ +$/, '');
    return text && i !== last ? text + ' ' : text;
  }).join('');
}
export function normalizeText(value: string): string {
  return decodeHTML(value).replace(/\s+/gu, ' ').trim();
}
