import { toast } from 'sonner';

export type CopyTextToClipboardOptions = {
    successMessage?: string;
    errorMessage?: string | ((error: unknown) => string);
};

export async function copyTextToClipboard(
    text: string,
    options: CopyTextToClipboardOptions = {}
): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
        if (typeof options.errorMessage === 'function') {
            const message = options.errorMessage(error);
            if (message) {
                toast.error(message);
            }
        } else if (options.errorMessage) {
            toast.error(options.errorMessage);
        }
        return false;
    }

    if (options.successMessage) {
        toast.success(options.successMessage);
    }
    return true;
}
