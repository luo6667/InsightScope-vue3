'use client';

import { Suspense } from 'react';

import Page from '@/views/ReportsPage';

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
