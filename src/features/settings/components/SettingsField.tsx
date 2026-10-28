import { RotateCcwIcon } from 'lucide-react';
import {
    Fragment,
    Children,
    cloneElement,
    isValidElement,
    type ReactElement,
    type ReactNode,
    useId
} from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { cn } from '@/lib/utils';
import { getSettingsManifestEntry } from '@/shared/constants/settingsManifest';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Field as ShadcnField,
    FieldContent,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    FieldTitle
} from '@/ui/shadcn/field';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { findDisabledAncestor, isSettingModified } from '../settingsFieldState';
import { useSettingsHighlightStore } from '../settingsHighlightStore';

type AttachableControlProps = {
    id?: string;
    'aria-invalid'?: boolean;
    children?: ReactNode;
};

type DisableableProps = {
    disabled?: boolean;
    children?: ReactNode;
};

type FieldProps = {
    settingId?: string;
    label?: ReactNode;
    description?: ReactNode;
    children?: ReactNode;
    className?: string;
    contentClassName?: string;
    controlClassName?: string;
    controlId?: string;
    error?: ReactNode;
    invalid?: boolean;
    disabled?: boolean;
    onReset?: () => void;
};

type SettingsSectionHeadingProps = {
    title?: ReactNode;
    description?: ReactNode;
};

type SegmentedPreferenceOption = {
    value: string;
    label: string;
};

type SegmentedPreferenceProps = {
    options: readonly SegmentedPreferenceOption[];
    value?: string;
    onChange?: (value: string) => void;
};

type JsonTreeViewProps = {
    data: unknown;
    name?: string;
    depth?: number;
};

function getAttachableControl(
    children: ReactNode
): ReactElement<AttachableControlProps> | null {
    if (Children.count(children) !== 1) {
        return null;
    }

    const child = Children.only(children);

    if (!isValidElement<AttachableControlProps>(child)) {
        return null;
    }

    const childProps = child.props;
    if (childProps.children != null) {
        return null;
    }

    return child;
}

function applyControlProps(
    children: ReactNode,
    controlId: string | undefined,
    invalid: boolean
): ReactNode {
    const child = getAttachableControl(children);

    if (!child) {
        return children;
    }

    return cloneElement(child, {
        id: child.props.id || controlId,
        'aria-invalid': child.props['aria-invalid'] || invalid || undefined
    });
}

function disableNode(node: ReactNode): ReactNode {
    if (Array.isArray(node)) {
        return node.map(disableNode);
    }
    if (!isValidElement<DisableableProps>(node)) {
        return node;
    }
    if (typeof node.type !== 'string' && node.type !== Fragment) {
        return cloneElement(node, { disabled: true });
    }
    const { children } = node.props;
    if (children == null) {
        return node;
    }
    return Array.isArray(children)
        ? cloneElement(node, undefined, ...children.map(disableNode))
        : cloneElement(node, undefined, disableNode(children));
}

export function Field({
    settingId,
    label,
    description,
    children,
    className = '',
    contentClassName = '',
    controlClassName = '',
    controlId,
    error,
    invalid = false,
    disabled = false,
    onReset
}: FieldProps) {
    const { t } = useTranslation();
    const entry = getSettingsManifestEntry(settingId);
    const { modified, blockedById } = usePreferencesStore(
        useShallow((state) => ({
            modified: isSettingModified(entry, state),
            blockedById: findDisabledAncestor(entry, state)?.id
        }))
    );
    const highlighted = useSettingsHighlightStore(
        (state) => Boolean(settingId) && state.settingId === settingId
    );
    const blockedBy = getSettingsManifestEntry(blockedById);
    const isDisabled = disabled || Boolean(blockedBy);
    const showReset = modified && Boolean(onReset);
    const isInvalid = invalid || Boolean(error);
    const generatedControlId = useId();
    const attachableControl = getAttachableControl(children);
    const labelControlId =
        controlId ||
        attachableControl?.props.id ||
        (attachableControl ? generatedControlId : undefined);
    const fieldLabel = (
        <FieldLabel htmlFor={labelControlId}>{label}</FieldLabel>
    );
    const controls = applyControlProps(children, labelControlId, isInvalid);

    return (
        <ShadcnField
            data-setting-id={settingId}
            data-disabled={isDisabled || undefined}
            data-invalid={isInvalid || undefined}
            data-modified={modified || undefined}
            data-highlighted={highlighted || undefined}
            className={cn(
                'border-stroke-subtle relative grid gap-3 border-b py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center',
                modified &&
                    'before:bg-muted-foreground before:absolute before:inset-y-3 before:-left-3 before:w-0.5 before:rounded-full',
                highlighted &&
                    'outline-ring rounded-sm outline-2 outline-offset-2',
                className
            )}
        >
            <FieldContent className={contentClassName}>
                {entry?.requiresRestart || modified ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {fieldLabel}
                        {entry?.requiresRestart ? (
                            <Badge variant="outline">
                                {t('view.settings.field.restart_required')}
                            </Badge>
                        ) : null}
                        {modified ? (
                            <span className="text-muted-foreground text-xs">
                                {t('view.settings.field.modified')}
                            </span>
                        ) : null}
                    </div>
                ) : (
                    fieldLabel
                )}
                {description ? (
                    <FieldDescription>{description}</FieldDescription>
                ) : null}
                {blockedBy ? (
                    <FieldDescription>
                        {t('view.settings.field.requires_parent', {
                            name: t(blockedBy.labelKey)
                        })}
                    </FieldDescription>
                ) : null}
                {error ? <FieldError>{error}</FieldError> : null}
            </FieldContent>
            <div
                className={cn(
                    'flex justify-self-start lg:w-full lg:justify-end lg:justify-self-stretch',
                    showReset && 'items-center gap-2',
                    controlClassName
                )}
            >
                {showReset ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-setting-reset
                        disabled={isDisabled}
                        onClick={onReset}
                    >
                        <RotateCcwIcon data-icon="inline-start" />
                        {t('view.settings.field.reset')}
                    </Button>
                ) : null}
                {Children.map(controls, (control) =>
                    isDisabled ? disableNode(control) : control
                )}
            </div>
        </ShadcnField>
    );
}

export function SettingsSectionHeading({
    title,
    description
}: SettingsSectionHeadingProps) {
    return (
        <div className="border-stroke-subtle flex flex-col gap-1 border-b pt-2 pb-2 first:pt-0">
            <FieldTitle>{title}</FieldTitle>
            {description ? (
                <FieldDescription>{description}</FieldDescription>
            ) : null}
        </div>
    );
}

export { FieldGroup };

export function SegmentedPreference({
    options,
    value,
    onChange
}: SegmentedPreferenceProps) {
    return (
        <ToggleGroup
            variant="outline"
            size="sm"
            value={value ? [value] : []}
            onValueChange={(nextValue) => {
                if (nextValue[0]) {
                    onChange?.(nextValue[0]);
                }
            }}
        >
            {options.map((option, index) => (
                <Fragment key={option.value}>
                    {index > 0 ? <ToggleGroupSeparator /> : null}
                    <ToggleGroupItem
                        value={option.value}
                        aria-label={option.label}
                    >
                        {option.label}
                    </ToggleGroupItem>
                </Fragment>
            ))}
        </ToggleGroup>
    );
}

export function JsonTreeView({
    data,
    name = '',
    depth = 0
}: JsonTreeViewProps) {
    if (data === null || typeof data !== 'object') {
        return (
            <div className="flex gap-2 font-mono text-xs">
                {name ? (
                    <span className="text-muted-foreground">{name}:</span>
                ) : null}
                <span>{JSON.stringify(data)}</span>
            </div>
        );
    }

    const entries = Array.isArray(data)
        ? data.map((value, index): [string, unknown] => [String(index), value])
        : Object.entries(data);
    const summary = `${name ? `${name}: ` : ''}${Array.isArray(data) ? `Array(${entries.length})` : `Object(${entries.length})`}`;

    return (
        <details open={depth < 2} className="font-mono text-xs">
            <summary className="text-muted-foreground cursor-pointer select-none">
                {summary}
            </summary>
            <div className="ml-4 border-l pl-3">
                {entries.map(([key, value]) => (
                    <JsonTreeView
                        key={key}
                        name={key}
                        data={value}
                        depth={depth + 1}
                    />
                ))}
            </div>
        </details>
    );
}
