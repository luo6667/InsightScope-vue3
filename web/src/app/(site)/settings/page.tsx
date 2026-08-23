'use client';

import { Suspense } from 'react';

import Page from '@/views/SettingsPage';

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
