import { ArchiveRestoreIcon, DatabaseIcon, NetworkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

type LoginPageUtilitiesProps = {
    disabled: boolean;
    isValidatingRestore: boolean;
    onMigrateLegacyVrcxData: () => void;
    onOpenProxyDialog: () => void;
    onRestoreProfileBackup: () => void;
    showLegacyMigration: boolean;
};

export function LoginPageUtilities({
    disabled,
    isValidatingRestore,
    onMigrateLegacyVrcxData,
    onOpenProxyDialog,
    onRestoreProfileBackup,
    showLegacyMigration
}: LoginPageUtilitiesProps) {
    const { t } = useTranslation();

    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={onOpenProxyDialog}>
                <NetworkIcon data-icon="inline-start" />
                {t('view.login.proxy_settings')}
            </Button>
            <Button
                type="button"
                variant="outline"
                disabled={disabled || isValidatingRestore}
                onClick={onRestoreProfileBackup}
            >
                {isValidatingRestore ? (
                    <Spinner data-icon="inline-start" />
                ) : (
                    <ArchiveRestoreIcon data-icon="inline-start" />
                )}
                {t('profile_backup.restore_from_backup')}
            </Button>
            {showLegacyMigration ? (
                <Button
                    type="button"
                    variant="outline"
                    className="sm:col-span-2"
                    disabled={disabled}
                    onClick={onMigrateLegacyVrcxData}
                >
                    <DatabaseIcon data-icon="inline-start" />
                    {t(
                        'view.settings.advanced.advanced.database_cleanup.legacy_migration'
                    )}
                </Button>
            ) : null}
        </div>
    );
}
