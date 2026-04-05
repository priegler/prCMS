'use client';

import { getCms } from '@inlinecms/react';

export default function Home() {
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 data-cms="app/page.tsx::Home>main>h1#children">
        {getCms("app/page.tsx::Home>main>h1#children", "Welcome to InlineCMS")}
      </h1>
      <p data-cms="app/page.tsx::Home>main>p#children">
        {getCms("app/page.tsx::Home>main>p#children", "This is a demo page for testing the inline CMS editing experience.")}
      </p>

      <section style={{ marginTop: '2rem' }}>
        <h2 data-cms="app/page.tsx::Home>main>section>h2#children">
          {getCms("app/page.tsx::Home>main>section>h2#children", "Features")}
        </h2>
        <p data-cms="app/page.tsx::Home>main>section>p#children">
          {getCms("app/page.tsx::Home>main>section>p#children", "Edit any text directly on the page. Changes are saved to content.json.")}
        </p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 data-cms="app/page.tsx::Home>main>section[1]>h2#children">
          {getCms("app/page.tsx::Home>main>section[1]>h2#children", "Getting Started")}
        </h2>
        <p data-cms="app/page.tsx::Home>main>section[1]>p#children">
          {getCms("app/page.tsx::Home>main>section[1]>p#children", "Add ?cms=edit to the URL to activate the editor overlay.")}
        </p>
        <p data-cms="app/page.tsx::Home>main>section[1]>p[1]#children">
          {getCms("app/page.tsx::Home>main>section[1]>p[1]#children", "Or press Ctrl+Shift+E to toggle edit mode.")}
        </p>
      </section>
    </main>
  );
}
