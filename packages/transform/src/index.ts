import { createUnplugin } from 'unplugin';
import { transformLocator, type TransformOptions } from './locator.js';
export { transformLocator, type TransformOptions } from './locator.js';
export const inlineCMS = createUnplugin<TransformOptions | undefined>(options => ({
  name: 'inlinecms-locator', enforce: 'pre',
  transformInclude: id => /\.[jt]sx(?:\?|$)/.test(id),
  transform(code, id) { return transformLocator(code, id, options); },
}));
export default inlineCMS;
