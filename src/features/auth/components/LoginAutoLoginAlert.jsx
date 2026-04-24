import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import { getAutoLoginStateLabel } from '../loginDisplay.js';

export function LoginAutoLoginAlert({
    visible,
    variant,
    target,
    state,
    onCancel,
    onRetry
}) {
    const { t } = useTranslation();

    if (!visible) {
        return null;
    }

    return (
        <Alert variant={variant}>
            <AlertDescription className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant="secondary">
                    {t('common.generated.generated.auto_login')}
                </Badge>
                <span className="font-medium">{target}</span>
                {state.status !== 'scheduled' && state.status !== 'idle' ? (
                    <span className="text-muted-foreground">
                        {getAutoLoginStateLabel(state.status)}
                    </span>
                ) : null}
                {state.remainingSeconds > 0 ? (
                    <span className="text-muted-foreground">
                        {state.remainingSeconds}
                        {t('common.time_units.s')}
                    </span>
                ) : null}
                {state.status === 'scheduled' ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onCancel}
                    >
                        {t('message.database.migration_skip')}
                    </Button>
                ) : null}
                {state.status === 'cancelled' ||
                state.status === 'failed' ||
                state.status === 'expired' ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onRetry}
                    >
                        {t('common.generated.generated.retry')}
                    </Button>
                ) : null}
            </AlertDescription>
        </Alert>
    );
}
