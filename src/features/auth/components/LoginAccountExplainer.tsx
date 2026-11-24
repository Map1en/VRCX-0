import { ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';

const EXPLAINER_KEYS = [
    'view.login.account_explainer.account_data',
    'view.login.account_explainer.password_destination',
    'view.login.account_explainer.local_storage',
    'view.login.account_explainer.open_source'
] as const;

export function LoginAccountExplainer() {
    const { t } = useTranslation();

    return (
        <Collapsible className="flex flex-col items-center">
            <CollapsibleTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="group text-muted-foreground max-w-full aria-expanded:bg-transparent"
                    >
                        <span className="min-w-0 truncate">
                            {t('view.login.account_explainer.title')}
                        </span>
                        <ChevronDownIcon
                            data-icon="inline-end"
                            className="-rotate-90 transition-transform group-aria-expanded:rotate-0"
                        />
                    </Button>
                }
            />
            <CollapsibleContent className="w-full">
                <ul className="text-muted-foreground list-disc space-y-1 rounded-lg border px-3 py-2 pl-7 text-xs leading-relaxed">
                    {EXPLAINER_KEYS.map((key) => (
                        <li key={key}>{t(key)}</li>
                    ))}
                </ul>
            </CollapsibleContent>
        </Collapsible>
    );
}
