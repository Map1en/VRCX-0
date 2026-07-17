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
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 truncate text-lg font-semibold">VRCX-0</div>
            <Select
                value={locale}
                onValueChange={(value) => {
                    if (value) {
                        onLanguageChange(value);
                    }
                }}
            >
                <SelectTrigger size="sm" className="w-36">
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
