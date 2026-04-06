'use client';

export default function Home() {
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '2rem' }}>
      <h1>Welcome to InlineCMS</h1>
      <p>This is a demo page for testing the inline CMS editing experience.</p>

      <section style={{ marginTop: '2rem' }}>
        <h2>Features</h2>
        <p>Edit any text directly on the page. Changes are saved to content.json.</p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Getting Started</h2>
        <p>Add ?cms=edit to the URL to activate the editor overlay.</p>
        <p>Or press Ctrl+Shift+E to toggle edit mode.</p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <img
          src="/placeholder.svg"
          alt="A placeholder image for testing"
          style={{ maxWidth: '100%', height: 'auto' }}
        />
      </section>
    </main>
  );
}
