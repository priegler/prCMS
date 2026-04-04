import type { InlineCMSConfig } from './core/config.js';

/**
 * Next.js config wrapper that registers the inline CMS Babel plugin.
 */
export default function withInlineCMS(nextConfig: Record<string, unknown> = {}, _cmsConfig?: Partial<InlineCMSConfig>) {
  return {
    ...nextConfig,
    // TODO: Wire up Babel plugin via next.config.js webpack override
  };
}
