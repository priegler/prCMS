import type { InlineCMSConfig } from './core/config.js';
import { DEFAULT_CONFIG } from './core/config.js';

/**
 * Next.js config wrapper that registers the inline CMS Babel plugin.
 *
 * Usage in next.config.js:
 *   const withInlineCMS = require('@inlinecms/babel-plugin/next').default;
 *   module.exports = withInlineCMS({ ... });
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
                  require.resolve('./transform/plugin.js'),
                  {
                    config: resolvedConfig,
                    projectRoot: options.dir ?? process.cwd(),
                    extractOnly: false,
                  },
                ],
              ],
              // Don't let Babel process things it shouldn't —
              // Next.js already handles TS/JSX via SWC
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
