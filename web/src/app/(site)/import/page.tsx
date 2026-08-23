'use client';

import { Suspense } from 'react';

import Page from '@/views/ImportPage';

export default function ImportPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
