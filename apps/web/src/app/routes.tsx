import type { RouteObject } from 'react-router';
import { RedirectIfSignedIn, RequireSession } from '@features/auth';
import { ImportsPage, NewImportPage, ReviewPage } from '@features/imports';
import { AccountsPage, CategoriesPage } from '@features/ledger';
import { BudgetsPage } from '@features/budgets';
import { EditRulePage, NewRulePage, RecurringPage } from '@features/recurring';
import { FamilyPage } from '@features/family';
import { ADD_TRANSACTION_PATH, DESTINATIONS } from './destinations';
import { LayoutScreen } from './layouts/layout-screen';
import { PlaceholderPage } from './pages/placeholder-page';
import { SettingsPage } from './pages/settings-page';
import { SignInPage } from './pages/signin-page';
import { InvitePage, NotFoundPage, RouteErrorPage } from './pages/status-pages';
import { DocumentLayout } from './document-layout';
import { ShellLayout } from './shell-layout';
import { UserLocalData } from './user-local-data';

const layoutScreens = { '/': 'dashboard', '/transactions': 'history' } as const;

const placeholderRoutes: RouteObject[] = DESTINATIONS.filter(
  (destination) =>
    destination.nav !== 'settings' &&
    destination.nav !== 'dashboard' &&
    destination.nav !== 'transactions' &&
    destination.nav !== 'accounts' &&
    destination.nav !== 'categories' &&
    destination.nav !== 'imports' &&
    destination.nav !== 'budgets' &&
    destination.nav !== 'recurring' &&
    destination.nav !== 'family',
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
              ...Object.entries(layoutScreens).map(([path, screen]) => ({
                path,
                element: <LayoutScreen screen={screen} />,
              })),
              { path: ADD_TRANSACTION_PATH, element: <LayoutScreen screen="entry" /> },
              { path: '/transactions/:id', element: <LayoutScreen screen="detail" /> },
              { path: '/accounts', element: <AccountsPage /> },
              { path: '/categories', element: <CategoriesPage /> },
              { path: '/imports', element: <ImportsPage /> },
              { path: '/imports/new', element: <NewImportPage /> },
              { path: '/imports/review', element: <ReviewPage /> },
              { path: '/budgets', element: <BudgetsPage /> },
              { path: '/recurring', element: <RecurringPage /> },
              { path: '/recurring/new', element: <NewRulePage /> },
              { path: '/recurring/:id', element: <EditRulePage /> },
              { path: '/family', element: <FamilyPage /> },
              { path: '/settings', element: <SettingsPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];
