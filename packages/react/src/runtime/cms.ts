import { readContentFile } from '@inlinecms/babel-plugin';

let contentCache: Record<string, Record<string, string>> = {};

const DEFAULT_LOCALE = process.env.INLINECMS_DEFAULT_LOCALE ?? 'en';

/**
 * Sync CMS content resolver for Server Components (RSC).
 * Reads from content.{locale}.json at request time.
 *
 * Fallback chain: locale-specific → default locale → hardcoded fallback.
 *
 * @param key - The content key (e.g. "app/page.tsx::Home>main>h1#children")
 * @param fallback - The original hardcoded string from source
 * @param locale - Optional locale override (defaults to detected locale)
 */
export function cms(key: string, fallback: string, locale?: string): string {
  const resolvedLocale = locale ?? getServerLocale();
  const content = getContentForLocale(resolvedLocale);

  if (content[key] !== undefined) {
    return content[key];
  }

  // Fall back to default locale if different from requested
  if (resolvedLocale !== DEFAULT_LOCALE) {
    const defaultContent = getContentForLocale(DEFAULT_LOCALE);
    if (defaultContent[key] !== undefined) {
      return defaultContent[key];
    }
  }

  return fallback;
}

function getServerLocale(): string {
  // In RSC context, try to read locale from headers/cookies.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cookies } = require('next/headers');
    const cookieStore = cookies();
    const localeCookie = cookieStore.get('inlinecms-locale');
    if (localeCookie?.value) return localeCookie.value;
  } catch {
    // Not in a Next.js server context
  }
  return DEFAULT_LOCALE;
}

function getContentForLocale(locale: string): Record<string, string> {
  if (contentCache[locale]) return contentCache[locale];

  const contentDir = process.env.INLINECMS_CONTENT_DIR ?? './content';
  const content = readContentFile(contentDir, locale);
  contentCache[locale] = content;
  return content;
}

/**
 * Clear the content cache. Called when content is updated via the API.
 */
export function invalidateContentCache(): void {
  contentCache = {};
}
