import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import { getAutoLoginStateLabel } from '../loginDisplay';

export function LoginAutoLoginAlert({
    visible,
    variant,
    target,
    autoLoginState,
    onCancel,
    onRetry
}: any) {
    const { t } = useTranslation();

    if (!visible) {
        return null;
    }

    return (
        <Alert variant={variant}>
            <AlertDescription className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant="secondary">
                    {t('common.label.auto_login')}
                </Badge>
                <span className="font-medium">{target}</span>
                {autoLoginState.status === 'scheduled' &&
                autoLoginState.detail ? (
                    <span className="text-muted-foreground">
                        {autoLoginState.detail}
                    </span>
                ) : null}
                {autoLoginState.status !== 'scheduled' &&
                autoLoginState.status !== 'idle' ? (
                    <span className="text-muted-foreground">
                        {getAutoLoginStateLabel(autoLoginState.status)}
                    </span>
                ) : null}
                {autoLoginState.status !== 'scheduled' &&
                autoLoginState.detail ? (
                    <span className="text-muted-foreground min-w-0 flex-1 basis-full">
                        {autoLoginState.detail}
                    </span>
                ) : null}
                {autoLoginState.status === 'scheduled' &&
                !autoLoginState.detail &&
                autoLoginState.remainingSeconds > 0 ? (
                    <span className="text-muted-foreground">
                        {autoLoginState.remainingSeconds}
                        {t('common.time_units.s')}
                    </span>
                ) : null}
                {autoLoginState.status === 'scheduled' ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onCancel}
                    >
                        {t('message.database.migration_skip')}
                    </Button>
                ) : null}
                {autoLoginState.status === 'cancelled' ||
                autoLoginState.status === 'failed' ||
                autoLoginState.status === 'expired' ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onRetry}
                    >
                        {t('common.action.retry')}
                    </Button>
                ) : null}
            </AlertDescription>
        </Alert>
    );
}
