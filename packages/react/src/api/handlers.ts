import { readContentFile, writeContentFile, mergeContent } from '@inlinecms/babel-plugin';

/**
 * Next.js App Router GET handler for CMS API.
 * Mount at: app/api/cms/[...action]/route.ts
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = getAction(url.pathname);

  switch (action) {
    case 'content': {
      const locale = url.searchParams.get('locale') ?? 'en';
      const contentDir = process.env.INLINECMS_CONTENT_DIR ?? './content';
      const content = readContentFile(contentDir, locale);
      return Response.json({ content, locale });
    }

    case 'auth': {
      // Check if the user has a valid auth cookie
      const cookie = request.headers.get('cookie') ?? '';
      const hasAuth = cookie.includes('inlinecms-auth=');
      if (hasAuth) {
        return Response.json({ authenticated: true });
      }
      return new Response('Not authenticated', { status: 401 });
    }

    default:
      return new Response('Not found', { status: 404 });
  }
}

/**
 * Next.js App Router POST handler for CMS API.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = getAction(url.pathname);

  switch (action) {
    case 'auth': {
      return handleAuth(request);
    }

    case 'save': {
      return handleSave(request);
    }

    case 'commit': {
      return handleCommit(request);
    }

    default:
      return new Response('Not found', { status: 404 });
  }
}

// ─── Action handlers ──────────────────────────────────────

async function handleAuth(request: Request): Promise<Response> {
  const secret = process.env.INLINE_CMS_SECRET;
  if (!secret) {
    return new Response('INLINE_CMS_SECRET not configured', { status: 500 });
  }

  const body = await request.json() as { secret?: string };
  if (body.secret !== secret) {
    return new Response('Invalid secret', { status: 401 });
  }

  return new Response(JSON.stringify({ authenticated: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `inlinecms-auth=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 7}`,
    },
  });
}

async function handleSave(request: Request): Promise<Response> {
  // Verify auth
  const cookie = request.headers.get('cookie') ?? '';
  const secret = process.env.INLINE_CMS_SECRET;
  if (!secret || !cookie.includes(`inlinecms-auth=${secret}`)) {
    return new Response('Not authenticated', { status: 401 });
  }

  const body = await request.json() as { locale?: string; changes?: Record<string, string> };
  const locale = body.locale ?? 'en';
  const changes = body.changes ?? {};

  if (Object.keys(changes).length === 0) {
    return new Response('No changes provided', { status: 400 });
  }

  const contentDir = process.env.INLINECMS_CONTENT_DIR ?? './content';
  const existing = readContentFile(contentDir, locale);
  const merged = mergeContent(existing, changes);
  writeContentFile(contentDir, locale, merged);

  return Response.json({ content: merged, locale });
}

async function handleCommit(request: Request): Promise<Response> {
  // Verify auth
  const cookie = request.headers.get('cookie') ?? '';
  const secret = process.env.INLINE_CMS_SECRET;
  if (!secret || !cookie.includes(`inlinecms-auth=${secret}`)) {
    return new Response('Not authenticated', { status: 401 });
  }

  try {
    const { execSync } = await import('child_process');
    const contentDir = process.env.INLINECMS_CONTENT_DIR ?? './content';

    execSync(`git add ${contentDir}`, { stdio: 'pipe' });
    execSync('git commit -m "CMS content update"', { stdio: 'pipe' });
    execSync('git push', { stdio: 'pipe' });

    return Response.json({ committed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Git operation failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Utils ────────────────────────────────────────────────

/**
 * Extract the action from the URL path.
 * e.g. /api/cms/save → "save", /api/cms/auth → "auth"
 */
function getAction(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  // Expect: ['api', 'cms', action]
  return segments[segments.length - 1] ?? '';
}
