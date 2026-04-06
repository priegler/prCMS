import type { InlineCMSConfig } from './core/config.js';
import { DEFAULT_CONFIG } from './core/config.js';
import { inlineCMSBabelPlugin } from './transform/plugin.js';

/**
 * Next.js config wrapper that registers the inline CMS Babel plugin.
 *
 * Usage in next.config.mjs:
 *   import withInlineCMS from '@inlinecms/babel-plugin/next';
 *   export default withInlineCMS({ ... });
 */
export default function withInlineCMS(
  nextConfig: Record<string, unknown> = {},
  cmsConfig?: Partial<InlineCMSConfig>,
) {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...cmsConfig };

  return {
    ...nextConfig,
    webpack(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: any,
    ) {
      const projectRoot = options.dir ?? process.cwd();

      // Add the inline CMS Babel plugin to the webpack Babel loader
      config.module.rules.push({
        test: /\.(tsx|jsx)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              plugins: [
                [
                  // Pass the plugin function directly — no require.resolve needed
                  inlineCMSBabelPlugin,
                  {
                    config: resolvedConfig,
                    projectRoot,
                    extractOnly: false,
                  },
                ],
              ],
              // Syntax-only parsing — don't transform JSX/TS,
              // Next.js SWC handles that after our plugin runs
              parserOpts: {
                plugins: ['jsx', 'typescript'],
              },
              presets: [],
            },
          },
        ],
      });

      // Call the user's existing webpack config if provided
      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, options);
      }
      return config;
    },
  };
}
