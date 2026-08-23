'use client';

import { Suspense } from 'react';

import Page from '@/views/AlertCenterPage';

export default function AlertCenterPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
