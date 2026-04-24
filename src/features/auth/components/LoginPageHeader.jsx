import { NetworkIcon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { getLanguageName, languageCodes } from '@/localization/index.js';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

export function LoginPageHeader({
    locale,
    disabled,
    onLanguageChange,
    onOpenProxyDialog
}) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                    <div className="truncate text-lg font-semibold">VRCX-0</div>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <Select
                    value={locale}
                    disabled={disabled}
                    onValueChange={onLanguageChange}
                >
                    <SelectTrigger size="sm" className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {languageCodes.map((code) => (
                                <SelectItem key={code} value={code}>
                                    {getLanguageName(code)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onOpenProxyDialog}
                >
                    <NetworkIcon data-icon="inline-start" />
                    {t('view.login.proxy_settings')}
                </Button>
            </div>
        </div>
    );
}
