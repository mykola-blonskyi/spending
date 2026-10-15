import { LogOut, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { useSignOut } from '@features/auth';
import { TimezoneSelect, useProfile, useUpdateProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { THEME_PREFERENCES, type ThemePreference } from '@shared/theme';
import { Button } from '@shared/ui/button';
import { Card } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { LanguageSelect } from '../language-select';
import { UserAvatar } from '../user-avatar';

const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const isThemePreference = (value: string): value is ThemePreference =>
  THEME_PREFERENCES.includes(value as ThemePreference);

function SettingRow({
  label,
  description,
  htmlFor,
  labelId,
  children,
}: {
  label: string;
  description: string;
  htmlFor?: string;
  labelId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
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
  const languageId = useId();
  const themeLabelId = useId();
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
