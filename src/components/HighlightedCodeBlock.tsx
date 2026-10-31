import { FileCodeIcon, TerminalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useHighlightedCode } from '@/lib/use-highlighted-code';
import {
    CodeBlock,
    CodeBlockActions,
    CodeBlockContent,
    CodeBlockCopyButton,
    CodeBlockHeader,
    CodeBlockLine,
    CodeBlockTitle
} from '@/ui/shadcn/code-block';

const SHELL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'shellscript', 'zsh']);

export function HighlightedCodeBlock({
    code,
    language,
    size,
    wrap,
    className,
    contentClassName
}: {
    code: string;
    language: string;
    size?: 'default' | 'sm';
    wrap?: boolean;
    className?: string;
    contentClassName?: string;
}) {
    const { t } = useTranslation();
    const lines = useHighlightedCode(code, language);
    const normalizedLanguage = language.toLowerCase();
    const actions = (
        <CodeBlockActions>
            <CodeBlockCopyButton
                value={code}
                aria-label={t('common.actions.copy')}
            />
        </CodeBlockActions>
    );

    return (
        <CodeBlock size={size} className={className}>
            {language ? (
                <CodeBlockHeader>
                    <CodeBlockTitle>
                        {SHELL_LANGUAGES.has(normalizedLanguage) ? (
                            <>
                                <TerminalIcon />
                                {t('common.label.terminal')}
                            </>
                        ) : (
                            <>
                                <FileCodeIcon />
                                {normalizedLanguage === 'json'
                                    ? 'JSON'
                                    : language}
                            </>
                        )}
                    </CodeBlockTitle>
                    {actions}
                </CodeBlockHeader>
            ) : (
                actions
            )}
            <CodeBlockContent wrap={wrap} className={contentClassName}>
                {lines.map((line, index) => (
                    <CodeBlockLine key={index}>{line}</CodeBlockLine>
                ))}
            </CodeBlockContent>
        </CodeBlock>
    );
}
