'use client';
import type { ReactNode } from 'react';
export function Button({ children }: { children: ReactNode }) {
  return <button style={{ background: '#2563eb', color: 'white', padding: '12px 20px', border: 0, borderRadius: 8 }} onClick={() => alert('Thanks for trying InlineCMS!')}>{children}</button>;
}
