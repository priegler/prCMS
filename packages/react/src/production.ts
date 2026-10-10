import React from 'react';
export function InlineCMS({ children }: { children: React.ReactNode; apiPath?: string }) {
  return React.createElement(React.Fragment, null, children);
}
