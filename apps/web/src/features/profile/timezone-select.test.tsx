import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '@i18n/index';
import { TimezoneSelect } from './timezone-select';

it('labels the chosen zone while closed and offers every zone once opened', async () => {
  Element.prototype.scrollIntoView = () => {};
  vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Asia/Seoul', 'Asia/Tokyo', 'Europe/Paris']);
  const onValueChange = vi.fn();
  render(
    <I18nProvider locale="en">
      <TimezoneSelect value="Asia/Tokyo" locale="en" onValueChange={onValueChange} />
    </I18nProvider>,
  );
  const trigger = screen.getByRole('combobox');
  expect(trigger).toHaveTextContent('Asia / Tokyo');

  trigger.focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(4);
  await userEvent.click(screen.getByRole('option', { name: /^Asia \/ Seoul/ }));
  expect(onValueChange).toHaveBeenCalledWith('Asia/Seoul');
});
