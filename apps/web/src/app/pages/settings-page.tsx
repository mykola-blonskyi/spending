import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { THEME_PREFERENCES, type ThemePreference, useTheme } from '@shared/theme';
import { Card } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { LanguageSelect } from '../language-select';

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
  const { preference, setPreference } = useTheme();
  const languageId = useId();
  const themeLabelId = useId();

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
            <LanguageSelect id={languageId} />
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
              value={preference}
              onValueChange={(value) => isThemePreference(value) && setPreference(value)}
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
        </Card>
      </section>
    </div>
  );
}
