import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';

export function SecretInput({
    className,
    disabled,
    ...props
}: Omit<ComponentProps<typeof InputGroupInput>, 'type'>) {
    const { t } = useTranslation();
    const [revealed, setRevealed] = useState(false);
    const toggleLabel = revealed
        ? t('common.actions.hide_secret')
        : t('common.actions.show_secret');

    return (
        <InputGroup className={className}>
            <InputGroupInput
                {...props}
                type={revealed ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
            />
            <InputGroupAddon align="inline-end">
                <InputGroupButton
                    size="icon-xs"
                    aria-label={toggleLabel}
                    aria-pressed={revealed}
                    title={toggleLabel}
                    disabled={disabled}
                    onClick={() => setRevealed((value) => !value)}
                >
                    {revealed ? <EyeOffIcon /> : <EyeIcon />}
                </InputGroupButton>
            </InputGroupAddon>
        </InputGroup>
    );
}
