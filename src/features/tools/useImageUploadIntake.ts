import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileDropTarget } from '@/components/file-drop/useFileDropTarget';
import { useImagePasteShortcut } from '@/components/keyboard/useImagePasteShortcut';
import { toast } from '@/services/toastService';

import {
    readClipboardUploadImage,
    readDroppedUploadImage,
    validateImageFile
} from './inventoryHelpers';

export function useImageUploadIntake<TTarget extends string, TAuthTarget>({
    enabled,
    activeTarget,
    canUploadTo,
    getAuthTarget,
    isCurrentAuthTarget,
    openCropRequest
}: {
    enabled: boolean;
    activeTarget: TTarget | null;
    canUploadTo(target: TTarget): boolean;
    getAuthTarget(): TAuthTarget;
    isCurrentAuthTarget(authTarget: TAuthTarget): boolean;
    openCropRequest(file: File, target: TTarget, authTarget: TAuthTarget): void;
}) {
    const { t } = useTranslation();
    const uploadInputRef = useRef<HTMLInputElement | null>(null);
    const pendingSelectionRef = useRef<{
        target: TTarget;
        authTarget: TAuthTarget;
    } | null>(null);
    const clipboardPastingRef = useRef(false);
    const [clipboardPasting, setClipboardPasting] = useState(false);

    function ensureCanUpload(target: TTarget) {
        if (canUploadTo(target)) {
            return true;
        }
        toast.add({ type: 'error', title: t('message.vrcplus.required') });
        return false;
    }

    function requestUpload(
        file: File,
        target: TTarget,
        authTarget: TAuthTarget
    ) {
        if (
            ensureCanUpload(target) &&
            validateImageFile(file, t) &&
            isCurrentAuthTarget(authTarget)
        ) {
            openCropRequest(file, target, authTarget);
        }
    }

    function beginUpload(target: TTarget) {
        if (!ensureCanUpload(target)) {
            return;
        }
        pendingSelectionRef.current = { target, authTarget: getAuthTarget() };
        uploadInputRef.current?.click();
    }

    function uploadSelectedFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        const selection = pendingSelectionRef.current;
        pendingSelectionRef.current = null;
        if (file && selection) {
            requestUpload(file, selection.target, selection.authTarget);
        }
    }

    async function pasteClipboardUpload(target: TTarget) {
        if (clipboardPastingRef.current) {
            return;
        }
        clipboardPastingRef.current = true;
        setClipboardPasting(true);
        const authTarget = getAuthTarget();
        try {
            const file = await readClipboardUploadImage(t);
            if (file) {
                requestUpload(file, target, authTarget);
            }
        } finally {
            clipboardPastingRef.current = false;
            setClipboardPasting(false);
        }
    }

    const intakeEnabled = enabled && activeTarget !== null && !clipboardPasting;
    const fileDropActive = useFileDropTarget({
        enabled: intakeEnabled,
        onDrop: async (paths) => {
            if (activeTarget === null) {
                return;
            }
            const authTarget = getAuthTarget();
            const file = await readDroppedUploadImage(paths, t);
            if (file) {
                requestUpload(file, activeTarget, authTarget);
            }
        }
    });
    const pasteScopeRef = useImagePasteShortcut<HTMLDivElement>({
        enabled: intakeEnabled,
        onPaste: () => {
            if (activeTarget !== null) {
                return pasteClipboardUpload(activeTarget);
            }
        }
    });

    return {
        beginUpload,
        clipboardPasting,
        fileDropActive,
        pasteClipboardUpload,
        pasteScopeRef,
        uploadInputRef,
        uploadSelectedFile
    };
}
