import { InlineCMS } from '@inlinecms/react/server';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><InlineCMS>{children}</InlineCMS></body></html>;
}
