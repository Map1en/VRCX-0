import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupTextarea
} from '@/ui/shadcn/input-group';

interface ComposerProps {
    busy: boolean;
    disabled: boolean;
    suggestions?: string[];
    toolbar?: ReactNode;
    onSend: (text: string) => void;
    onStop: () => void;
}

export function Composer({
    busy,
    disabled,
    suggestions,
    toolbar,
    onSend,
    onStop
}: ComposerProps) {
    const { t } = useTranslation();
    const [value, setValue] = useState('');

    const submit = () => {
        const text = value.trim();
        if (!text || disabled) {
            return;
        }
        onSend(text);
        setValue('');
    };

    return (
        <form
            className="p-3 pt-2"
            onSubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            {suggestions?.length ? (
                <div className="mb-2 flex [scrollbar-width:none] gap-2 overflow-x-auto overscroll-x-contain">
                    {suggestions.map((suggestion) => (
                        <Button
                            key={suggestion}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => onSend(suggestion)}
                        >
                            {suggestion}
                        </Button>
                    ))}
                </div>
            ) : null}
            <InputGroup className="dark:has-disabled:bg-input/30 rounded-xl has-disabled:bg-transparent has-disabled:opacity-100">
                <InputGroupTextarea
                    value={value}
                    disabled={disabled}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                        if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                        ) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                    placeholder={t('assistant.composer_placeholder')}
                    className="max-h-48 min-h-14 px-3.5 pt-3"
                    rows={2}
                />
                <InputGroupAddon align="block-end" className="gap-1">
                    {toolbar}
                    {busy ? (
                        <InputGroupButton
                            size="icon-sm"
                            variant="secondary"
                            onClick={onStop}
                            title={t('assistant.stop')}
                            aria-label={t('assistant.stop')}
                            className="ml-auto rounded-full"
                        >
                            <SquareIcon />
                        </InputGroupButton>
                    ) : (
                        <InputGroupButton
                            type="submit"
                            size="icon-sm"
                            variant="default"
                            disabled={disabled || !value.trim()}
                            title={t('assistant.send')}
                            aria-label={t('assistant.send')}
                            className="ml-auto rounded-full"
                        >
                            <ArrowUpIcon />
                        </InputGroupButton>
                    )}
                </InputGroupAddon>
            </InputGroup>
        </form>
    );
}
