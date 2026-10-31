import { ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HighlightedCodeBlock } from '@/components/HighlightedCodeBlock';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import { isRecord } from '@/shared/utils/record';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Spinner } from '@/ui/shadcn/spinner';

type AccountStandingState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'loaded'; json: Record<string, unknown> };

export function UserAccountStandingDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const [state, setState] = useState<AccountStandingState>({
        status: 'loading'
    });

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        setState({ status: 'loading' });
        commands
            .appVrchatCurrentUserAccountStandingGet()
            .then((response) => {
                const { json } = unwrapVrchatResponse(
                    response,
                    'auth/user/accountStanding'
                );
                if (!cancelled) {
                    setState({
                        status: 'loaded',
                        json: isRecord(json) ? json : {}
                    });
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setState({
                        status: 'error',
                        message: userFacingErrorMessage(
                            error,
                            t('dialog.user.account_standing.load_failed')
                        )
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [open, t]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.user.account_standing.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.user.account_standing.description')}
                    </DialogDescription>
                </DialogHeader>
                {state.status === 'loading' ? (
                    <div className="flex justify-center py-6">
                        <Spinner />
                    </div>
                ) : state.status === 'error' ? (
                    <p className="text-destructive text-sm">{state.message}</p>
                ) : (
                    <AccountStandingContent json={state.json} />
                )}
            </DialogContent>
        </Dialog>
    );
}

function AccountStandingContent({ json }: { json: Record<string, unknown> }) {
    const { t } = useTranslation();
    const standing = typeof json.standing === 'string' ? json.standing : '';
    const issueClearDays =
        typeof json.issueClearDays === 'number' ? json.issueClearDays : 0;
    const sanctionCount = Array.isArray(json.sanctions)
        ? json.sanctions.length
        : 0;
    const isGood = standing === 'good';
    const StandingIcon = isGood ? ShieldCheckIcon : ShieldAlertIcon;

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">
                    {t('dialog.user.account_standing.status')}
                </dt>
                <dd
                    className={
                        isGood
                            ? 'flex items-center gap-1.5 text-emerald-500'
                            : 'flex items-center gap-1.5 text-amber-500'
                    }
                >
                    <StandingIcon className="size-4" />
                    {standing || '—'}
                </dd>
                {issueClearDays > 0 ? (
                    <>
                        <dt className="text-muted-foreground">
                            {t('dialog.user.account_standing.issue_clear_days')}
                        </dt>
                        <dd>{issueClearDays}</dd>
                    </>
                ) : null}
                {sanctionCount > 0 ? (
                    <>
                        <dt className="text-muted-foreground">
                            {t('dialog.user.account_standing.sanctions')}
                        </dt>
                        <dd>{sanctionCount}</dd>
                    </>
                ) : null}
            </dl>
            <HighlightedCodeBlock
                code={JSON.stringify(json, null, 2)}
                language="json"
                size="sm"
                contentClassName="max-h-[55vh]"
            />
        </div>
    );
}
