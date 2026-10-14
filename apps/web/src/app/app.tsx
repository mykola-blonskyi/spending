import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { onAuthLost } from '@data/auth-events';
import { createQueryClient } from '@data/query-client';
import { AppProviders } from './providers';
import { routes } from './routes';

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));

  useEffect(
    () =>
      onAuthLost(() => {
        queryClient.clear();
        const { pathname, search } = window.location;
        if (pathname !== '/signin') {
          void router.navigate(`/signin?${new URLSearchParams({ returnTo: pathname + search })}`);
        }
      }),
    [queryClient, router],
  );

  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
