import React from 'react';
import { isEnabled } from '@inlinecms/core/config';

/** Mount from a server layout so normal production renders include no CMS client. */
export async function InlineCMS({ children, apiPath = '/api/cms' }: { children: React.ReactNode; apiPath?: string }): Promise<React.ReactElement> {
  if (!isEnabled()) return React.createElement(React.Fragment, null, children);
  const { InlineCMSProvider } = await import('./index.js');
  return React.createElement(InlineCMSProvider, { children, apiPath });
}
