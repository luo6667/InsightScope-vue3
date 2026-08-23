'use client';

import { Suspense } from 'react';

import Page from '@/views/DatasetsPage';

export default function DatasetsPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
