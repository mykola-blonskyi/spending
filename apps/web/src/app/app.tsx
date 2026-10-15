import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { createQueryClient } from '@data/query-client';
import { installAuthLostHandler } from '@features/auth';
import { AppProviders } from './providers';
import { routes } from './routes';
import { UpdatePrompt } from './update-prompt';

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));

  useEffect(
    () => installAuthLostHandler(queryClient, (to) => void router.navigate(to, { replace: true })),
    [queryClient, router],
  );

  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </AppProviders>
  );
}
