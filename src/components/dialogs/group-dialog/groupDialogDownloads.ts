import { saveJsonFile } from '@/services/shellIntegrationService';

export async function downloadJsonFile(fileName: string, value: unknown) {
    await saveJsonFile(fileName, JSON.stringify(value ?? null, null, 2));
}
