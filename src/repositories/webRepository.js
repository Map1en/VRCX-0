import { backend } from '../platform/tauri/index.js';
import { normalizePlatformError } from '../platform/tauri/errors.js';

class WebRepository {
    async clearCookies() {
        return backend.web.clearCookies();
    }

    async getCookies() {
        return backend.web.getCookies();
    }

    async setCookies(cookie) {
        return backend.web.setCookies(cookie);
    }

    async execute(options) {
        if (!options) {
            throw new Error('WebRepository.execute requires an options object');
        }

        try {
            const response = await backend.web.execute(options);

            if (response && typeof response === 'object') {
                if ('Item1' in response || 'Item2' in response) {
                    if (response.Item1 === -1) {
                        throw response.Item2 ?? new Error('Web API request failed');
                    }

                    return {
                        status: response.Item1,
                        data: response.Item2,
                        raw: response
                    };
                }

                if ('status' in response || 'data' in response) {
                    return {
                        status: response.status ?? 0,
                        data: response.data ?? null,
                        raw: response
                    };
                }
            }

            return {
                status: 0,
                data: response,
                raw: response
            };
        } catch (error) {
            throw normalizePlatformError(error, 'Web API execution failed');
        }
    }
}

const webRepository = new WebRepository();

export { WebRepository };
export default webRepository;
