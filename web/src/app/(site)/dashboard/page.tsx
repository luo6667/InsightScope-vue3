'use client';

import { Suspense } from 'react';

import Page from '@/views/DashboardPage';

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
