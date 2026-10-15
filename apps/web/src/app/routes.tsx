import type { RouteObject } from 'react-router';
import { RedirectIfSignedIn, RequireSession } from '@features/auth';
import { EditTransactionPage, NewTransactionPage, TransactionsPage } from '@features/transactions';
import { ADD_TRANSACTION_PATH, DESTINATIONS } from './destinations';
import { PlaceholderPage } from './pages/placeholder-page';
import { SettingsPage } from './pages/settings-page';
import { SignInPage } from './pages/signin-page';
import { InvitePage, NotFoundPage, RouteErrorPage } from './pages/status-pages';
import { DocumentLayout } from './document-layout';
import { ShellLayout } from './shell-layout';
import { UserLocalData } from './user-local-data';

const placeholderRoutes: RouteObject[] = DESTINATIONS.filter(
  (destination) => destination.nav !== 'settings' && destination.nav !== 'transactions',
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
            <UserLocalData>
              <ShellLayout />
            </UserLocalData>
          </RequireSession>
        ),
        errorElement: <RouteErrorPage />,
        children: [
          {
            errorElement: <RouteErrorPage />,
            children: [
              ...placeholderRoutes,
              { path: '/transactions', element: <TransactionsPage /> },
              { path: ADD_TRANSACTION_PATH, element: <NewTransactionPage /> },
              { path: '/transactions/:id', element: <EditTransactionPage /> },
              { path: '/settings', element: <SettingsPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];
