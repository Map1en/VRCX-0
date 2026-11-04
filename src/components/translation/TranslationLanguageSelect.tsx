import { getLanguageName, languageCodes } from '@/localization/index';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

export function TranslationLanguageSelect({
    value,
    label,
    className,
    onChange
}: {
    value: string;
    label: string;
    className?: string;
    onChange(value: string): void;
}) {
    return (
        <Select
            value={value}
            onValueChange={(next) => {
                if (next) {
                    onChange(next);
                }
            }}
        >
            <SelectTrigger size="sm" className={className} aria-label={label}>
                <SelectValue>{getLanguageName(value)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="min-w-48">
                <SelectGroup>
                    {languageCodes.map((code: string) => (
                        <SelectItem
                            key={code}
                            value={code}
                            className="whitespace-nowrap"
                        >
                            {getLanguageName(code)}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}
