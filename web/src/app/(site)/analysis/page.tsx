'use client';

import { Suspense } from 'react';

import Page from '@/views/AnalysisPage';

export default function AnalysisPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
