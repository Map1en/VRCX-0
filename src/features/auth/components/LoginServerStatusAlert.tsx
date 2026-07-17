import { ExternalLinkIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';

type LoginServerStatusAlertProps = {
    indicator: string;
    status: string;
    summary: string;
    onOpenStatusPage: () => void;
};

export function LoginServerStatusAlert({
    indicator,
    status,
    summary,
    onOpenStatusPage
}: LoginServerStatusAlertProps) {
    const { t } = useTranslation();
    const hasIssue = Boolean(indicator && indicator !== 'none');

    if (!hasIssue) {
        return null;
    }

    const isMajor = ['major', 'critical'].includes(indicator);
    const message = summary || status;

    return (
        <Alert variant={isMajor ? 'destructive' : 'default'}>
            <TriangleAlertIcon />
            <AlertTitle>{t('status_bar.servers_issue')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-1">
                {message ? (
                    <span className="line-clamp-2">{message}</span>
                ) : null}
                <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={onOpenStatusPage}
                >
                    {t('status_bar.view_status')}
                    <ExternalLinkIcon data-icon="inline-end" />
                </Button>
            </AlertDescription>
        </Alert>
    );
}
