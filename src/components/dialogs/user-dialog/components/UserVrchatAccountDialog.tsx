import {
    ChevronRightIcon,
    ShieldAlertIcon,
    ShieldCheckIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HighlightedCodeBlock } from '@/components/HighlightedCodeBlock';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands, type ContentFilter } from '@/platform/tauri/bindings';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import currentUserProfileService from '@/services/currentUserProfileService';
import { toast } from '@/services/toastService';
import { isRecord } from '@/shared/utils/record';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

const CONTENT_FILTER_OPTIONS = [
    { value: 'content_gore', labelKey: 'gore' },
    { value: 'content_horror', labelKey: 'horror' },
    { value: 'content_violence', labelKey: 'violence' },
    { value: 'content_sex', labelKey: 'sex' },
    { value: 'content_adult', labelKey: 'adult' }
] as const satisfies readonly { value: ContentFilter; labelKey: string }[];

function isContentFilter(value: unknown): value is ContentFilter {
    return CONTENT_FILTER_OPTIONS.some((option) => option.value === value);
}

function knownContentFilters(value: unknown): ContentFilter[] {
    return Array.isArray(value) ? value.filter(isContentFilter) : [];
}

type AccountStandingState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'loaded'; json: Record<string, unknown> };

export function UserVrchatAccountDialog({
    open,
    onOpenChange,
    currentUserId,
    contentFilters,
    hideContentFilterSettings
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentUserId: string;
    contentFilters: unknown;
    hideContentFilterSettings: boolean;
}) {
    const { t } = useTranslation();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.user.vrchat_account.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.user.vrchat_account.description')}
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="accountStanding" className="min-w-0 gap-4">
                    <TabsList className="w-full">
                        <TabsTrigger value="accountStanding" className="flex-1">
                            {t(
                                'dialog.user.vrchat_account.tabs.account_standing'
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="contentFilters" className="flex-1">
                            {t(
                                'dialog.user.vrchat_account.tabs.content_filters'
                            )}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="accountStanding">
                        <AccountStandingPanel />
                    </TabsContent>
                    <TabsContent value="contentFilters" keepMounted>
                        {hideContentFilterSettings ? (
                            <p className="text-muted-foreground text-sm">
                                {t(
                                    'dialog.user.vrchat_account.content_filters.unavailable'
                                )}
                            </p>
                        ) : (
                            <ContentFiltersPanel
                                currentUserId={currentUserId}
                                contentFilters={contentFilters}
                            />
                        )}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

function ContentFiltersPanel({
    currentUserId,
    contentFilters
}: {
    currentUserId: string;
    contentFilters: unknown;
}) {
    const { t } = useTranslation();
    const [localFilters, setLocalFilters] = useState<ContentFilter[] | null>(
        null
    );
    const [pending, setPending] = useState(false);
    const filters = localFilters ?? knownContentFilters(contentFilters);

    async function toggleFilter(filter: ContentFilter, enabled: boolean) {
        if (pending) {
            return;
        }
        const previous = filters;
        const next = enabled
            ? [...previous.filter((value) => value !== filter), filter]
            : previous.filter((value) => value !== filter);
        setLocalFilters(next);
        setPending(true);
        try {
            const profile = await currentUserProfileService.updateCurrentUser({
                userId: currentUserId,
                params: { contentFilters: next }
            });
            setLocalFilters(
                Array.isArray(profile.contentFilters)
                    ? knownContentFilters(profile.contentFilters)
                    : next
            );
        } catch (error) {
            setLocalFilters(previous);
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t(
                        'dialog.user.vrchat_account.content_filters.update_failed'
                    )
                )
            });
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex min-w-0 flex-col gap-3">
            <p className="text-muted-foreground text-sm">
                {t('dialog.user.vrchat_account.content_filters.description')}
            </p>
            <div className="rounded-lg border">
                {CONTENT_FILTER_OPTIONS.map((option) => {
                    const id = `vrchat-content-filter-${option.labelKey}`;
                    return (
                        <Field
                            key={option.value}
                            orientation="horizontal"
                            className="items-center justify-between gap-3 border-b px-3 py-2.5 last:border-b-0"
                        >
                            <FieldLabel htmlFor={id} className="min-w-0">
                                {t(
                                    `dialog.user.vrchat_account.content_filters.items.${option.labelKey}`
                                )}
                            </FieldLabel>
                            <Switch
                                id={id}
                                checked={filters.includes(option.value)}
                                disabled={pending}
                                onCheckedChange={(checked) => {
                                    void toggleFilter(option.value, checked);
                                }}
                            />
                        </Field>
                    );
                })}
            </div>
        </div>
    );
}

function AccountStandingPanel() {
    const { t } = useTranslation();
    const [state, setState] = useState<AccountStandingState>({
        status: 'loading'
    });

    useEffect(() => {
        let cancelled = false;
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
    }, [t]);

    if (state.status === 'loading') {
        return (
            <div className="flex justify-center py-6">
                <Spinner />
            </div>
        );
    }
    if (state.status === 'error') {
        return <p className="text-destructive text-sm">{state.message}</p>;
    }
    return <AccountStandingContent json={state.json} />;
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
        <div className="flex min-w-0 flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5 text-sm">
                <dt className="text-muted-foreground">
                    {t('dialog.user.account_standing.status')}
                </dt>
                <dd
                    className={
                        isGood
                            ? 'flex items-center gap-1.5 text-emerald-500 capitalize'
                            : 'flex items-center gap-1.5 text-amber-500 capitalize'
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
            <Collapsible>
                <CollapsibleTrigger
                    render={
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="group text-muted-foreground -ml-2 aria-expanded:bg-transparent"
                        />
                    }
                >
                    <ChevronRightIcon
                        data-icon="inline-start"
                        className="transition-transform duration-150 ease-out group-data-[panel-open]:rotate-90"
                    />
                    {t('dialog.user.account_standing.raw_data')}
                </CollapsibleTrigger>
                <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-150 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                    <div className="pt-2">
                        <HighlightedCodeBlock
                            code={JSON.stringify(json, null, 2)}
                            language="json"
                            size="sm"
                            contentClassName="max-h-[45vh]"
                        />
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
