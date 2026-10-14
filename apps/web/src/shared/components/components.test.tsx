import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, ErrorState, MoneyText, SyncStatusBadge, type SyncStatus } from './index';

describe('MoneyText', () => {
  it('speaks negative amounts with a word, not a dash', () => {
    const { container } = render(<MoneyText amountMinor={-1250} currency="EUR" colored />);
    expect(container.querySelector('[aria-hidden]')).toHaveTextContent('-€12.50');
    expect(container.querySelector('.sr-only')).toHaveTextContent('minus €12.50');
    expect(container.firstElementChild).toHaveClass('text-expense', 'tabular');
  });

  it('colors money in as income only when asked', () => {
    const { container, rerender } = render(<MoneyText amountMinor={500} currency="USD" />);
    expect(container.firstElementChild).not.toHaveClass('text-income');
    rerender(<MoneyText amountMinor={500} currency="USD" colored signDisplay="exceptZero" />);
    expect(container.firstElementChild).toHaveClass('text-income');
    expect(container.querySelector('.sr-only')).toHaveTextContent('+$5.00');
  });
});

describe('SyncStatusBadge', () => {
  it.each<[SyncStatus, string]>([
    [{ state: 'synced' }, 'Up to date'],
    [{ state: 'syncing' }, 'Syncing…'],
    [{ state: 'pending', count: 3 }, '3 pending'],
    [{ state: 'retrying' }, 'Retrying…'],
    [{ state: 'offline', count: 0 }, 'Offline'],
    [{ state: 'offline', count: 2 }, 'Offline, 2 pending'],
    [{ state: 'failed', count: 1 }, '1 failed'],
    [{ state: 'authRequired' }, 'Sign in to sync'],
    [{ state: 'conflict', count: 2 }, '2 conflicts'],
  ])('shows %o as "%s"', (status, label) => {
    render(<SyncStatusBadge status={status} />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(screen.getByRole('status')).toHaveAttribute('data-state', status.state);
  });
});

describe('ErrorState', () => {
  it('announces itself and retries', async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Something went wrong" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('ConfirmDialog', () => {
  function Harness({ onConfirm }: { onConfirm: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete account?"
        description="This removes all its transactions."
        confirmLabel="Delete"
        confirmPhrase="Main card"
        onConfirm={onConfirm}
      />
    );
  }

  it('keeps the destructive action disabled until the phrase is typed', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete account?' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(dialog).toHaveTextContent('To confirm, type Main card below.');
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Confirmation phrase'), 'Main car');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Confirmation phrase'), 'd');
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
