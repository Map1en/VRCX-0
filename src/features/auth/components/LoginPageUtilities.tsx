import { ArchiveRestoreIcon, NetworkIcon, SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';

type LoginPageUtilitiesProps = {
    disabled: boolean;
    isValidatingRestore: boolean;
    onOpenProxyDialog: () => void;
    onRestoreProfileBackup: () => void;
};

export function LoginPageUtilities({
    disabled,
    isValidatingRestore,
    onOpenProxyDialog,
    onRestoreProfileBackup
}: LoginPageUtilitiesProps) {
    const { t } = useTranslation();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('view.login.more_options')}
                    >
                        {isValidatingRestore ? <Spinner /> : <SettingsIcon />}
                    </Button>
                }
            />
            <DropdownMenuContent align="end" className="w-auto">
                <DropdownMenuItem onClick={onOpenProxyDialog}>
                    <NetworkIcon />
                    {t('view.login.proxy_settings')}
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={disabled || isValidatingRestore}
                    onClick={onRestoreProfileBackup}
                >
                    <ArchiveRestoreIcon />
                    {t('profile_backup.restore_from_backup')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
