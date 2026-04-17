/**
 * Minimal MD5 implementation for user ID → hue colour mapping.
 * Only used for deterministic colour generation, not for security.
 *
 * Matches the C# implementation:
 *   MD5(userId) → (hash[3] << 8) | hash[4]
 */

/* eslint-disable no-bitwise */

const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21
];

const K = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
    0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
    0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
    0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
    0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
    0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
]);

function md5(input) {
    const encoder = new TextEncoder();
    const msg = encoder.encode(input);
    const bitLen = msg.length * 8;

    // Pre-processing: padding
    const padLen = (56 - ((msg.length + 1) % 64) + 64) % 64;
    const buf = new Uint8Array(msg.length + 1 + padLen + 8);
    buf.set(msg);
    buf[msg.length] = 0x80;
    // Append original length in bits as 64-bit LE
    const view = new DataView(buf.buffer);
    view.setUint32(buf.length - 8, bitLen >>> 0, true);
    view.setUint32(buf.length - 4, 0, true); // high 32 bits (always 0 for short strings)

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < buf.length; offset += 64) {
        const M = new Uint32Array(16);
        for (let j = 0; j < 16; j++) {
            M[j] = view.getUint32(offset + j * 4, true);
        }

        let A = a0;
        let B = b0;
        let C = c0;
        let D = d0;

        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) {
                F = (B & C) | (~B & D);
                g = i;
            } else if (i < 32) {
                F = (D & B) | (~D & C);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D;
                g = (3 * i + 5) % 16;
            } else {
                F = C ^ (B | ~D);
                g = (7 * i) % 16;
            }
            F = (F + A + K[i] + M[g]) >>> 0;
            A = D;
            D = C;
            C = B;
            B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
        }

        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    // Build hash bytes (little-endian)
    const hash = new Uint8Array(16);
    const hv = new DataView(hash.buffer);
    hv.setUint32(0, a0, true);
    hv.setUint32(4, b0, true);
    hv.setUint32(8, c0, true);
    hv.setUint32(12, d0, true);
    return hash;
}

/**
 * Compute a deterministic 16-bit hue value from a VRChat user ID.
 * Matches the C# implementation: MD5(userId) → (byte[3] << 8) | byte[4]
 *
 * @param {string} userId
 * @returns {number} 0–65535
 */
export function getColourFromUserID(userId) {
    const hash = md5(userId);
    return (hash[3] << 8) | hash[4];
}

/**
 * Batch version: returns a map of userId → hue for each given ID.
 *
 * @param {Iterable<string>} userIds
 * @returns {Record<string, number>}
 */
export function getColourBulk(userIds) {
    const output = {};
    for (const userId of userIds) {
        output[userId] = getColourFromUserID(userId);
    }
    return output;
}
