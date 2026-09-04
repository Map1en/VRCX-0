import { ChevronRightIcon, CopyIcon, MoreHorizontalIcon } from 'lucide-react';
import {
    type ComponentProps,
    type ComponentType,
    type CSSProperties,
    type ReactNode,
    useEffect,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { collapseAllNested, JsonView } from 'react-json-view-lite';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/services/clipboardService';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader } from '@/ui/shadcn/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Textarea } from '@/ui/shadcn/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

type ClassNameAndChildren = {
    className?: string;
    children?: ReactNode;
};

function EntityDialogScaffold({ className, children }: ClassNameAndChildren) {
    return (
        <div
            className={cn(
                'flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4',
                className
            )}
        >
            {children}
        </div>
    );
}

function EntityDialogTwoColumnLayout({
    rail,
    children,
    railWidth = '20rem',
    railMaxHeight = '42vh',
    className,
    railClassName,
    contentClassName
}: ClassNameAndChildren & {
    rail: ReactNode;
    railWidth?: string;
    railMaxHeight?: string;
    railClassName?: string;
    contentClassName?: string;
}) {
    const layoutStyle: CSSProperties & {
        '--entity-dialog-rail-width': string;
        '--entity-dialog-rail-max-height': string;
    } = {
        '--entity-dialog-rail-width': railWidth,
        '--entity-dialog-rail-max-height': railMaxHeight
    };
    return (
        <div
            className={cn(
                'flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden min-[880px]:grid min-[880px]:grid-cols-[var(--entity-dialog-rail-width)_minmax(0,1fr)]',
                className
            )}
            style={layoutStyle}
        >
            <div
                className={cn(
                    'max-h-[var(--entity-dialog-rail-max-height)] min-h-0 min-w-0 shrink-0 overflow-auto p-px min-[880px]:max-h-none min-[880px]:shrink min-[880px]:overflow-y-auto',
                    railClassName
                )}
            >
                {rail}
            </div>
            <div
                className={cn(
                    'flex min-h-0 min-w-0 flex-1 flex-col',
                    contentClassName
                )}
            >
                {children}
            </div>
        </div>
    );
}

function EntityOverviewCard({
    media,
    children,
    className,
    headerClassName,
    contentClassName,
    style
}: ClassNameAndChildren & {
    media?: ReactNode;
    headerClassName?: string;
    contentClassName?: string;
    style?: CSSProperties;
}) {
    return (
        <Card
            size="sm"
            style={style}
            className={cn(
                'min-w-0 overflow-visible border shadow-none ring-0',
                className
            )}
        >
            <CardHeader className={cn('gap-3', headerClassName)}>
                {media}
            </CardHeader>
            <CardContent
                className={cn('flex flex-col gap-3', contentClassName)}
            >
                {children}
            </CardContent>
        </Card>
    );
}

export type EntityDialogTab = {
    value: string;
    label: ReactNode;
};

function EntityDialogTabs({
    value,
    onValueChange,
    tabs,
    children
}: {
    value: string;
    onValueChange: (value: string) => void;
    tabs: EntityDialogTab[];
    children?: ReactNode;
}) {
    return (
        <Tabs
            value={value}
            onValueChange={onValueChange}
            className="flex min-h-0 flex-1 flex-col gap-0"
        >
            <TabsList
                variant="underline"
                className="relative flex h-11 min-h-11 w-full justify-start overflow-x-auto overflow-y-hidden rounded-none border-b bg-transparent p-0"
            >
                {tabs.map((tab) => (
                    <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="text-muted-foreground hover:text-foreground data-active:text-primary h-11 flex-none rounded-none border-0 bg-transparent px-3 shadow-none after:hidden data-active:bg-transparent data-active:shadow-none"
                    >
                        {tab.label}
                    </TabsTrigger>
                ))}
            </TabsList>
            {children}
        </Tabs>
    );
}

function EntityDialogTabContent({
    value,
    className,
    children,
    forceMount = false
}: ClassNameAndChildren & {
    value: string;
    forceMount?: boolean;
}) {
    return (
        <TabsContent
            value={value}
            keepMounted={forceMount || undefined}
            className={cn(
                'm-0 min-h-0 flex-1 overflow-auto pt-4 data-hidden:hidden',
                className
            )}
        >
            {children}
        </TabsContent>
    );
}

function EntityMemoTextarea({
    label = '',
    value = '',
    placeholder = '',
    onSave
}: {
    label?: ReactNode;
    value?: string;
    placeholder?: string;
    onSave?: (value: string) => void | Promise<void>;
}) {
    const { t } = useTranslation();
    const normalizedValue = typeof value === 'string' ? value : '';
    const [draft, setDraft] = useState(normalizedValue);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setDraft(normalizedValue);
    }, [normalizedValue]);

    async function saveDraft() {
        if (!onSave || saving || draft === normalizedValue) {
            return;
        }
        setSaving(true);
        try {
            await onSave(draft);
        } catch (error) {
            toast.error(
                userFacingErrorMessage(
                    error,
                    t('common.error.failed_to_save_memo')
                )
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="box-border flex w-full cursor-default items-center p-1.5 text-sm">
            <div className="flex-1 overflow-hidden">
                <span className="block truncate leading-5 font-medium">
                    {label}
                </span>
                <Textarea
                    value={draft}
                    rows={2}
                    placeholder={placeholder}
                    disabled={saving}
                    className="mt-1 min-h-0 resize-none text-xs"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                        saveDraft();
                    }}
                />
            </div>
        </div>
    );
}

function EntityActionDropdown({
    children,
    busy = false,
    dangerous = false,
    indicator = false
}: {
    children?: ReactNode;
    busy?: boolean;
    dangerous?: boolean;
    indicator?: boolean;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        size="icon-lg"
                        variant={dangerous ? 'destructive' : 'outline'}
                        aria-label={'Open entity actions'}
                        className="relative"
                    >
                        {busy ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <MoreHorizontalIcon data-icon="inline-start" />
                        )}
                        {indicator ? (
                            <span className="bg-primary absolute top-1.5 right-1.5 size-2 rounded-full" />
                        ) : null}
                    </Button>
                }
            />
            <DropdownMenuContent
                align="end"
                className="**:data-[variant=destructive]:text-destructive! **:data-[variant=destructive]:**:text-destructive! min-w-56"
            >
                <DropdownMenuGroup>{children}</DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function EntityActionItem({
    children,
    icon: Icon,
    destructive = false,
    disabled = false,
    shortcut = null,
    onClick
}: {
    children?: ReactNode;
    icon?: ComponentType;
    destructive?: boolean;
    disabled?: boolean;
    shortcut?: ReactNode;
    onClick?: ComponentProps<typeof DropdownMenuItem>['onClick'];
}) {
    return (
        <DropdownMenuItem
            disabled={disabled}
            variant={destructive ? 'destructive' : 'default'}
            onClick={(event) => {
                if (disabled) {
                    event.preventDefault();
                    return;
                }
                onClick?.(event);
            }}
        >
            {Icon ? <Icon /> : null}
            <span className="min-w-0 flex-1">{children}</span>
            {shortcut ? <span className="ml-auto">{shortcut}</span> : null}
        </DropdownMenuItem>
    );
}

function EntityActionSeparator() {
    return <DropdownMenuSeparator />;
}

function EntityActionSub({
    children,
    icon: Icon,
    label,
    disabled = false
}: {
    children?: ReactNode;
    icon?: ComponentType;
    label: ReactNode;
    disabled?: boolean;
}) {
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={disabled}>
                {Icon ? <Icon /> : null}
                <span className="min-w-0 flex-1">{label}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
                side="right"
                align="start"
                className="min-w-56"
            >
                <DropdownMenuGroup>{children}</DropdownMenuGroup>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

type EntityRawJsonProps = {
    value: Record<string, unknown>;
};

const entityJsonViewStyles = {
    container: 'entity-json-view',
    childFieldsContainer: 'entity-json-view-fields',
    basicChildStyle: 'entity-json-view-row',
    collapseIcon: 'entity-json-view-collapse',
    expandIcon: 'entity-json-view-expand',
    collapsedContent: 'entity-json-view-collapsed',
    label: 'entity-json-view-label',
    clickableLabel: 'entity-json-view-clickable-label',
    nullValue: 'entity-json-view-null',
    undefinedValue: 'entity-json-view-null',
    numberValue: 'entity-json-view-number',
    stringValue: 'entity-json-view-string',
    booleanValue: 'entity-json-view-boolean',
    otherValue: 'entity-json-view-value',
    punctuation: 'entity-json-view-punctuation',
    quotesForFieldNames: true,
    stringifyStringValues: true
};

function EntityRawJson({ value }: EntityRawJsonProps) {
    const { t } = useTranslation();
    const rawValue = Object.fromEntries(
        Object.entries(value).filter(([key]) => !key.startsWith('$'))
    );

    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-end">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                        await copyTextToClipboard(
                            JSON.stringify(rawValue, null, 2)
                        );
                    }}
                >
                    <CopyIcon data-icon="inline-start" />
                    {t('common.actions.copy')}
                </Button>
            </div>
            <div className="bg-muted/20 max-h-[55vh] overflow-auto rounded-md border p-3 text-xs">
                <JsonView
                    data={rawValue}
                    style={entityJsonViewStyles}
                    shouldExpandNode={collapseAllNested}
                    clickToExpandNode
                />
            </div>
        </div>
    );
}

function EntityBlank({ children = '—' }: { children?: ReactNode }) {
    return <div className="text-muted-foreground text-sm">{children}</div>;
}

function EntityFactList({ children, className }: ClassNameAndChildren) {
    return (
        <div
            className={cn(
                'text-muted-foreground/80 flex min-w-0 flex-col text-xs',
                className
            )}
        >
            {children}
        </div>
    );
}

function EntityFactRow({
    label,
    value,
    children
}: {
    label: ReactNode;
    value?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="flex min-h-6 min-w-0 items-center justify-between gap-2">
            <span className="text-muted-foreground min-w-0 truncate">
                {label}
            </span>
            {children || (
                <span className="text-muted-foreground/80 min-w-0 truncate text-right">
                    {value || '—'}
                </span>
            )}
        </div>
    );
}

function EntityFactValue({
    display,
    title,
    mono = true,
    children
}: {
    display: ReactNode;
    title?: string;
    mono?: boolean;
    children?: ReactNode;
}) {
    return (
        <span className="-mr-1 flex min-w-0 items-center justify-end gap-1">
            <span
                className={cn(
                    'text-muted-foreground/80 min-w-0 truncate',
                    mono && 'font-mono text-[11px]'
                )}
                title={title}
            >
                {display}
            </span>
            {children}
        </span>
    );
}

function EntityFactAction({
    label,
    icon: Icon,
    onClick
}: {
    label: string;
    icon: ComponentType;
    onClick?: () => void;
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        aria-label={label}
                        size="icon-xs"
                        variant="ghost"
                        onClick={onClick}
                    >
                        <Icon />
                    </Button>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function EntityInfoGrid({ children, className }: ClassNameAndChildren) {
    return (
        <div
            className={cn('flex flex-wrap items-start gap-1 px-2.5', className)}
        >
            {children}
        </div>
    );
}

function EntityInfoBlock({
    label,
    value,
    mono = false,
    full = false,
    wide = false,
    onClick,
    children
}: {
    label: ReactNode;
    value?: ReactNode;
    mono?: boolean;
    full?: boolean;
    wide?: boolean;
    onClick?: () => void;
    children?: ReactNode;
}) {
    const Component = onClick ? 'button' : 'div';
    return (
        <Component
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            className={cn(
                'group/info-item flex items-start rounded-lg px-2 py-1.5 text-left text-sm transition-colors outline-none [&>svg:not([class*=size-])]:size-3.5',
                full ? 'w-full' : wide ? 'w-80' : 'w-44',
                onClick
                    ? 'hover:bg-muted active:bg-muted/70 focus-visible:border-ring focus-visible:ring-ring/50 cursor-pointer focus-visible:ring-3'
                    : 'cursor-default'
            )}
        >
            <div className="min-w-0 flex-1 overflow-hidden">
                <span className="text-muted-foreground block truncate text-xs leading-snug">
                    {label}
                </span>
                {children || (
                    <span
                        className={cn(
                            'block truncate text-sm leading-snug font-medium',
                            mono ? 'font-mono text-xs font-normal' : ''
                        )}
                    >
                        {value || '—'}
                    </span>
                )}
            </div>
            {onClick ? (
                <ChevronRightIcon
                    data-icon="inline-end"
                    className="text-muted-foreground mt-0.5 ml-2 shrink-0 opacity-70 transition-transform group-hover/info-item:translate-x-0.5"
                />
            ) : null}
        </Component>
    );
}

export {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityActionSub,
    EntityBlank,
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityDialogTwoColumnLayout,
    EntityFactAction,
    EntityFactList,
    EntityFactRow,
    EntityFactValue,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea,
    EntityOverviewCard,
    EntityRawJson
};
