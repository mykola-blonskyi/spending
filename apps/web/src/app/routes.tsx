import { Plus } from 'lucide-react';
import type { RouteObject } from 'react-router';
import { RedirectIfSignedIn, RequireSession } from '@features/auth';
import { ADD_TRANSACTION_PATH, DESTINATIONS } from './destinations';
import { PlaceholderPage } from './pages/placeholder-page';
import { SettingsPage } from './pages/settings-page';
import { SignInPage } from './pages/signin-page';
import { InvitePage, NotFoundPage, RouteErrorPage } from './pages/status-pages';
import { DocumentLayout } from './document-layout';
import { ShellLayout } from './shell-layout';

const placeholderRoutes: RouteObject[] = DESTINATIONS.filter(
  (destination) => destination.nav !== 'settings',
).map(({ path, nav, icon }) => ({
  path,
  element: <PlaceholderPage page={nav} icon={icon} />,
}));

export const routes: RouteObject[] = [
  {
    element: <DocumentLayout />,
    children: [
      {
        path: '/signin',
        element: (
          <RedirectIfSignedIn>
            <SignInPage />
          </RedirectIfSignedIn>
        ),
        errorElement: <RouteErrorPage />,
      },
      { path: '/invite/:token', element: <InvitePage />, errorElement: <RouteErrorPage /> },
      {
        element: (
          <RequireSession>
            <ShellLayout />
          </RequireSession>
        ),
        errorElement: <RouteErrorPage />,
        children: [
          {
            errorElement: <RouteErrorPage />,
            children: [
              ...placeholderRoutes,
              {
                path: ADD_TRANSACTION_PATH,
                element: <PlaceholderPage page="addTransaction" icon={Plus} />,
              },
              { path: '/settings', element: <SettingsPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];
