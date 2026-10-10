import { Button } from '../components/Button';
import { features } from '../content/features';
export const metadata = { title: 'InlineCMS · Source-first editing', description: 'Inline editing for sites built with coding agents.' };
export default function Home() {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <header>
        <p style={{ color: '#2563eb', fontWeight: 700 }}>Built with your agent. Edited by you.</p>
        <h1 style={{ fontSize: 48, letterSpacing: '-2px' }}>Your website, in your own words.</h1>
        <p>Click any text, make it yours, and publish a small change to the source.</p>
        <Button>Try source-first editing</Button>
      </header>
      <section style={{ marginTop: 48 }}>
        <h2>Copy that stays close to the code</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {features.map(feature => <article key={feature.title} style={{ background: '#f1f5f9', padding: 24, borderRadius: 12 }}>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>)}
        </div>
      </section>
      <section style={{ marginTop: 48 }}>
        <h2>A little more human</h2>
        <p>Hello <strong>curious people</strong>, welcome to your next idea.</p>
        <img src="/workspace.svg" alt="A bright desk ready for your next idea" title="Your creative workspace" style={{ width: '100%', borderRadius: 16 }} />
        <label>Project name <input placeholder="Give your next idea a name" aria-label="Project name input" /></label>
      </section>
      <footer style={{ marginTop: 48 }}>
        <p>Add ?cms=edit to the URL, or press Ctrl+Shift+E to open the editor.</p>
      </footer>
    </main>
  );
}
