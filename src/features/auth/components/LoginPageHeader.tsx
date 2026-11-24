import { GlobeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getLanguageName, languageCodes } from '@/localization/index';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

type LoginPageHeaderProps = {
    locale: string;
    onLanguageChange: (value: string) => void;
};

export function LoginPageHeader({
    locale,
    onLanguageChange
}: LoginPageHeaderProps) {
    const { t } = useTranslation();
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <div className="truncate text-lg font-semibold">VRCX-0</div>
                <div className="text-muted-foreground text-xs">
                    {t('view.login.tagline')}
                </div>
            </div>
            <Select
                value={locale}
                onValueChange={(value) => {
                    if (value) {
                        onLanguageChange(value);
                    }
                }}
            >
                <SelectTrigger
                    size="sm"
                    className="text-muted-foreground w-auto border-transparent bg-transparent shadow-none"
                >
                    <GlobeIcon />
                    <SelectValue>{getLanguageName(locale || 'en')}</SelectValue>
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
        </div>
    );
}
