import { transformLocator, type TransformOptions } from './locator.js';
interface LoaderContext {
  resourcePath: string; rootContext: string; getOptions(): TransformOptions;
  callback(error: Error | null, code?: string, map?: unknown): void;
}
function loader(this: LoaderContext, code: string, sourceMap: unknown) {
  try {
    const result = transformLocator(code, this.resourcePath, { root: this.rootContext, ...this.getOptions() });
    this.callback(null, result?.code ?? code, result?.map ?? sourceMap);
  } catch (error) { this.callback(error as Error); }
}
export default loader;
