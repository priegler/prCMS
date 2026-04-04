import { InlineCMSProvider } from '@inlinecms/react';

export const metadata = {
  title: 'InlineCMS Demo',
  description: 'Demo app for inline CMS editing',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <InlineCMSProvider defaultLocale="en" locales={['en', 'de']}>
          {children}
        </InlineCMSProvider>
      </body>
    </html>
  );
}
