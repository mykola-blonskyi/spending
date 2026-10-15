import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@data/api-error';
import { api } from '@data/client';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
  deleteFamily,
  eventsQuery,
  type FamilyEvent,
  type Invitation,
  invitationPreviewQuery,
  invitationsQuery,
  leaveFamily,
  revokeInvitation,
  type WorkspaceView,
  workspacesQuery,
} from '@data/family';
import { createQueryClient } from '@data/query-client';
import { meQuery } from '@data/session';
import { useWorkspaces } from '@data/sync';
import { testProfile, testSession } from '@data/testing';
import { I18nProvider } from '@i18n/index';
import { AuthorBadge } from './author-badge';
import { FamilyPage } from './family-page';
import { InviteFlow } from './invite-flow';
import { ScopeField } from './scope-field';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(import('@data/family'), async (importOriginal) => ({
  ...(await importOriginal()),
  createFamily: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  leaveFamily: vi.fn(),
  deleteFamily: vi.fn(),
}));
vi.mock(import('@data/sync'), async (importOriginal) => ({
  ...(await importOriginal()),
  useWorkspaces: vi.fn(() => ({ ready: true, items: [] })),
}));

const ann = { userId: testProfile.id, displayName: 'Ann Example', avatarUrl: null };
const bob = { userId: '00000000-0000-4000-8000-000000000002', displayName: 'Bob', avatarUrl: null };
const PERSONAL: WorkspaceView = {
  id: 'ws-personal',
  kind: 'personal',
  name: 'Ann',
  role: 'owner',
  members: [],
};
const family = (role: 'owner' | 'member'): WorkspaceView => ({
  id: 'ws-family',
  kind: 'family',
  name: 'Home',
  role,
  members: [
    { ...ann, role, joinedAt: '2026-10-01T10:00:00.000Z' },
    { ...bob, role: role === 'owner' ? 'member' : 'owner', joinedAt: '2026-10-02T10:00:00.000Z' },
  ],
});

type Client = ReturnType<typeof createQueryClient>;

function setup(ui: React.ReactNode, seed: (client: Client) => void = () => {}, path = '/family') {
  const client = createQueryClient();
  client.setQueryData(meQuery.queryKey, testProfile);
  seed(client);
  const utils = render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/family" element={ui} />
            <Route path="/invite/:token" element={ui} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

const seeded =
  (
    workspaces: WorkspaceView[],
    extra: { invitations?: Invitation[]; events?: FamilyEvent[] } = {},
  ) =>
  (client: Client) => {
    client.setQueryData(workspacesQuery.queryKey, workspaces);
    client.setQueryData(invitationsQuery.queryKey, extra.invitations ?? []);
    client.setQueryData(eventsQuery.queryKey, extra.events ?? []);
  };

beforeEach(() => {
  vi.clearAllMocks();
  // Refetches after a change must settle at once; a 4xx is never retried.
  vi.spyOn(api, 'GET').mockRejectedValue(
    new ApiError({ status: 404, code: 'NOT_FOUND', message: 'not found' }),
  );
});

describe('FamilyPage', () => {
  it('creates a family from the empty state', async () => {
    vi.mocked(createFamily).mockResolvedValue(family('owner'));
    setup(<FamilyPage />, seeded([PERSONAL]));

    await userEvent.type(await screen.findByLabelText('Family name'), '  Home ');
    await userEvent.click(screen.getByRole('button', { name: 'Create family' }));

    await waitFor(() => expect(vi.mocked(createFamily).mock.calls[0]?.[0]).toEqual('Home'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Family created'));
  });

  it('lists members with roles and offers invitations and deletion to the owner', async () => {
    setup(
      <FamilyPage />,
      seeded([PERSONAL, family('owner')], {
        invitations: [
          {
            id: 'inv-1',
            state: 'pending',
            createdAt: '2026-10-10T10:00:00.000Z',
            expiresAt: '2026-10-17T10:00:00.000Z',
            acceptedAt: null,
            revokedAt: null,
            acceptedBy: null,
          },
          {
            id: 'inv-2',
            state: 'accepted',
            createdAt: '2026-10-01T10:00:00.000Z',
            expiresAt: '2026-10-08T10:00:00.000Z',
            acceptedAt: '2026-10-02T10:00:00.000Z',
            revokedAt: null,
            acceptedBy: { userId: bob.userId, displayName: 'Bob' },
          },
        ],
      }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    const members = screen.getByRole('list', { name: 'Members' });
    expect(within(members).getAllByRole('listitem')).toHaveLength(2);
    expect(within(members).getByText('Ann Example')).toBeInTheDocument();
    expect(within(members).getByText('Owner')).toBeInTheDocument();
    expect(within(members).getByText('Member')).toBeInTheDocument();

    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Accepted by Bob')).toBeInTheDocument();
    expect(screen.getByText(/As the owner you cannot leave/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave family' })).not.toBeInTheDocument();

    vi.mocked(revokeInvitation).mockResolvedValue();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(vi.mocked(revokeInvitation).mock.calls[0]?.[0]).toEqual('inv-1'));

    vi.mocked(deleteFamily).mockResolvedValue();
    await userEvent.click(screen.getByRole('button', { name: 'Delete family' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Entries return to their authors');
    const confirm = within(dialog).getByRole('button', { name: 'Delete family' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Confirmation phrase'), 'Home');
    await userEvent.click(confirm);
    await waitFor(() => expect(vi.mocked(deleteFamily).mock.calls[0]?.[0]).toEqual('Home'));
  });

  it('shows a member the copyable link flow only after creating one, and lets them leave', async () => {
    setup(<FamilyPage />, seeded([PERSONAL, family('member')]));

    expect(await screen.findByRole('button', { name: 'Leave family' })).toBeInTheDocument();
    expect(screen.queryByText('Invitations')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bob' })).not.toBeInTheDocument();

    vi.mocked(leaveFamily).mockResolvedValue();
    await userEvent.click(screen.getByRole('button', { name: 'Leave family' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Leave family' }),
    );
    await waitFor(() => expect(leaveFamily).toHaveBeenCalled());
  });

  it('shows the invitation link once and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.mocked(createInvitation).mockResolvedValue({
      id: 'inv-3',
      url: 'http://app.test/invite/abc',
      expiresAt: '2026-10-22T00:00:00.000Z',
    });
    setup(<FamilyPage />, seeded([PERSONAL, family('owner')]));

    await userEvent.click(await screen.findByRole('button', { name: 'Create invitation link' }));
    await waitFor(() => expect(vi.mocked(createInvitation).mock.calls[0]?.[0]).toEqual(7));
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(
      'http://app.test/invite/abc',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith('http://app.test/invite/abc');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Link copied'));
    vi.unstubAllGlobals();
  });

  it('reads the event log in the order given, naming former members', async () => {
    setup(
      <FamilyPage />,
      seeded([PERSONAL, family('member')], {
        events: [
          {
            id: 'e2',
            type: 'member_removed',
            actor: ann,
            subject: null,
            createdAt: '2026-10-03T10:00:00.000Z',
          },
          {
            id: 'e1',
            type: 'family_created',
            actor: ann,
            subject: null,
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ],
      }),
    );
    const items = within(await screen.findByRole('list', { name: 'Activity' })).getAllByRole(
      'listitem',
    );
    expect(items[0]).toHaveTextContent('Ann Example removed A former member');
    expect(items[1]).toHaveTextContent('Ann Example created the family');
  });
});

describe('InviteFlow', () => {
  const token = 'tok';
  const gone = new ApiError({ status: 410, code: 'INVITATION_INVALID', message: 'gone' });

  it('previews and joins, then goes to the family', async () => {
    vi.mocked(acceptInvitation).mockResolvedValue(family('member'));
    setup(
      <InviteFlow token={token} />,
      (client) => {
        seeded([PERSONAL])(client);
        client.setQueryData(invitationPreviewQuery(token).queryKey, {
          familyName: 'Home',
          ownerName: 'Bob',
          expiresAt: '2026-10-22T00:00:00.000Z',
          state: 'pending',
        });
      },
      `/invite/${token}`,
    );

    expect(await screen.findByRole('heading', { name: 'Join Home?' })).toBeInTheDocument();
    expect(screen.getByText(/Bob invited you/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Join Home' }));
    await waitFor(() => expect(vi.mocked(acceptInvitation).mock.calls[0]?.[0]).toEqual(token));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Welcome to Home'));
  });

  it('shows one generic message for any unusable link', async () => {
    vi.spyOn(api, 'GET').mockRejectedValue(gone);
    setup(<InviteFlow token={token} />, seeded([PERSONAL]), `/invite/${token}`);

    expect(
      await screen.findByRole('heading', { name: 'This invitation is no longer valid' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Join/ })).not.toBeInTheDocument();
  });

  it('tells someone already in a family that they cannot join another', async () => {
    setup(<InviteFlow token={token} />, seeded([PERSONAL, family('member')]), `/invite/${token}`);
    expect(
      await screen.findByRole('heading', { name: 'You are already in a family' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Leave Home before joining another/)).toBeInTheDocument();
  });
});

describe('ScopeField and AuthorBadge', () => {
  it('offers the scope only to family members', () => {
    const { rerender } = setup(<ScopeField value="personal" onValueChange={() => {}} />);
    expect(screen.queryByRole('radio', { name: 'Family' })).not.toBeInTheDocument();

    vi.mocked(useWorkspaces).mockReturnValue({
      ready: true,
      items: [{ id: 'ws-family', kind: 'family', name: 'Home', role: 'member' }],
    });
    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <I18nProvider locale="en">
          <ScopeField value="personal" onValueChange={() => {}} />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('radio', { name: 'Personal' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Family' })).toBeInTheDocument();
  });

  it('names the author of a family entry and who paid when the account is hidden', () => {
    setup(
      <>
        <AuthorBadge entry={{ scope: 'personal', author: ann, accountId: null }} />
        <AuthorBadge entry={{ scope: 'family', author: null, accountId: null }} />
        <AuthorBadge entry={{ scope: 'family', author: bob, accountId: null }} />
        <AuthorBadge entry={{ scope: 'family', author: bob, accountId: 'acc-1' }} />
      </>,
      seeded([PERSONAL, family('member')]),
    );
    expect(screen.getByText('Ann Example')).toBeInTheDocument();
    expect(screen.getByText('Paid by Bob')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});
