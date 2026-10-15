import { LogOut, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { useSignOut } from '@features/auth';
import { TimezoneSelect, useProfile, useUpdateProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { cn } from '@shared/lib/utils';
import {
  isPalette,
  PALETTES,
  THEME_PREFERENCES,
  type ThemePreference,
  useTheme,
} from '@shared/theme';
import { Button } from '@shared/ui/button';
import { Card } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { LanguageSelect } from '../language-select';
import { LayoutThumbnail } from '../layouts/layout-thumbnail';
import { LAYOUT_IDS, type Layout } from '../layouts/registry';
import { UserAvatar } from '../user-avatar';

const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const isThemePreference = (value: string): value is ThemePreference =>
  THEME_PREFERENCES.includes(value as ThemePreference);
const isLayout = (value: string): value is Layout => LAYOUT_IDS.includes(value as Layout);

const pickerItem =
  'h-auto flex-col items-center gap-2 rounded-lg border border-transparent p-2 text-xs font-medium whitespace-normal text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:border-primary/40 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground';

function SettingRow({
  label,
  description,
  htmlFor,
  labelId,
  stacked,
  children,
}: {
  label: string;
  description: string;
  htmlFor?: string;
  labelId?: string;
  /** The control sits under the label instead of beside it. */
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 p-5',
        !stacked && 'sm:flex-row sm:items-center sm:justify-between sm:gap-6',
      )}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={htmlFor} id={labelId} className="text-[15px]">
          {label}
        </Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const t = useTranslations();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const signOut = useSignOut();
  const { resolved } = useTheme();
  const languageId = useId();
  const themeLabelId = useId();
  const layoutLabelId = useId();
  const paletteLabelId = useId();
  const timezoneId = useId();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('pages.settings.title')} description={t('pages.settings.description')} />
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-sm font-medium text-muted-foreground">
          {t('settings.appearance')}
        </h2>
        <Card className="gap-0 divide-y py-0">
          <SettingRow
            label={t('settings.language.label')}
            description={t('settings.language.description')}
            htmlFor={languageId}
          >
            <LanguageSelect
              id={languageId}
              onValueChange={(locale) => updateProfile.mutate({ locale })}
            />
          </SettingRow>
          <SettingRow
            label={t('settings.theme.label')}
            description={t('settings.theme.description')}
            labelId={themeLabelId}
          >
            <ToggleGroup
              type="single"
              variant="outline"
              aria-labelledby={themeLabelId}
              className="w-full sm:w-auto"
              value={profile.theme}
              onValueChange={(theme) => isThemePreference(theme) && updateProfile.mutate({ theme })}
            >
              {THEME_PREFERENCES.map((option) => {
                const Icon = THEME_ICONS[option];
                return (
                  <ToggleGroupItem
                    key={option}
                    value={option}
                    className="flex-1 gap-1.5 px-3 sm:flex-none"
                  >
                    <Icon aria-hidden />
                    {t(`settings.theme.${option}`)}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </SettingRow>
          <SettingRow
            label={t('settings.palette.label')}
            description={t('settings.palette.description')}
            labelId={paletteLabelId}
            stacked
          >
            <ToggleGroup
              type="single"
              spacing={2}
              aria-labelledby={paletteLabelId}
              className="flex flex-wrap"
              value={profile.palette}
              onValueChange={(palette) => isPalette(palette) && updateProfile.mutate({ palette })}
            >
              {PALETTES.map((palette) => (
                <ToggleGroupItem key={palette} value={palette} className={cn(pickerItem, 'w-20')}>
                  <span
                    aria-hidden
                    data-palette={palette}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-full bg-background ring-1 ring-border',
                      resolved === 'dark' && 'dark',
                    )}
                  >
                    <span className="size-5 rounded-full bg-primary" />
                  </span>
                  {t(`settings.palette.${palette}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingRow>
          <SettingRow
            label={t('settings.layout.label')}
            description={t('settings.layout.description')}
            labelId={layoutLabelId}
            stacked
          >
            <ToggleGroup
              type="single"
              spacing={2}
              aria-labelledby={layoutLabelId}
              className="grid w-full grid-cols-2 sm:grid-cols-4"
              value={profile.layout}
              onValueChange={(layout) => isLayout(layout) && updateProfile.mutate({ layout })}
            >
              {LAYOUT_IDS.map((layout) => (
                <ToggleGroupItem key={layout} value={layout} className={cn(pickerItem, 'w-full')}>
                  <LayoutThumbnail layout={layout} />
                  {t(`settings.layout.${layout}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingRow>
          <SettingRow
            label={t('settings.timezone.label')}
            description={t('settings.timezone.description')}
            htmlFor={timezoneId}
          >
            <TimezoneSelect
              id={timezoneId}
              value={profile.timezone}
              locale={profile.locale}
              onValueChange={(timezone) => updateProfile.mutate({ timezone })}
            />
          </SettingRow>
        </Card>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-sm font-medium text-muted-foreground">{t('settings.account')}</h2>
        <Card className="gap-0 py-0">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar profile={profile} className="size-10" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{profile.displayName}</span>
                <span className="truncate text-sm text-muted-foreground">{profile.email}</span>
              </div>
            </div>
            <Button variant="outline" disabled={signOut.busy} onClick={signOut.request}>
              <LogOut aria-hidden />
              {t('actions.signOut')}
            </Button>
          </div>
          <p className="border-t px-5 py-3 text-sm text-pretty text-muted-foreground">
            {t('settings.signOutNote')}
          </p>
        </Card>
        {signOut.dialog}
      </section>
    </div>
  );
}
