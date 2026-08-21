const env = require('../../config/env');

const GEMINI_MODEL = env.GEMINI_MODEL;
const GEMINI_API_KEY = env.GEMINI_API_KEY;

const GEMINI_TIMEOUT_MS = 15000; // fail fast instead of hanging on a stalled connection
const MAX_ATTEMPTS = 2; // 1 initial + 1 retry — only on timeout/network failure, never on a real API error response

function providerError(message, code = 'AI_PROVIDER_ERROR') {
    console.error('[Gemini Provider Error]', message);
    const err = new Error(message);
    err.code = code;
    return err;
}

// AbortController-based timeout wrapper. Without this, a stalled Gemini
// connection hangs indefinitely instead of failing predictably.
async function fetchWithTimeout(url, options, timeoutMs = GEMINI_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err.name === 'AbortError') {
            const timeoutErr = new Error(`Gemini request timed out after ${timeoutMs}ms`);
            timeoutErr.code = 'AI_TIMEOUT';
            throw timeoutErr;
        }
        throw err; // genuine network failure (DNS, connection reset) — rethrown as-is
    } finally {
        clearTimeout(timer);
    }
}

// Retries once, only on timeout or network-level failure (raw TypeError from
// fetch) — never on a real Gemini API error response, since retrying an
// actual rejection wastes time and rate-limit budget for the same result.
async function withRetry(fn, attempts = MAX_ATTEMPTS) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const isRetryable = err.code === 'AI_TIMEOUT' || err instanceof TypeError;
            if (!isRetryable || i === attempts - 1) throw err;
            console.warn(`[Gemini] attempt ${i + 1} failed (${err.code || err.message}), retrying...`);
            await new Promise((r) => setTimeout(r, 500));
        }
    }
    throw lastErr;
}

// Converts a raw fetch-level failure into a providerError, preserving the
// AI_TIMEOUT code specifically so it can be surfaced with a distinct
// user-facing message downstream.
function toProviderError(err) {
    if (err.code === 'AI_TIMEOUT') {
        return providerError('Gemini request timed out.', 'AI_TIMEOUT');
    }
    return providerError(`Network error calling Gemini: ${err.message}`);
}

async function generateText({ prompt }) {
    if (!GEMINI_API_KEY) {
        throw providerError('GEMINI_API_KEY not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    let response;
    try {
        response = await withRetry(() =>
            fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            })
        );
    } catch (err) {
        throw toProviderError(err);
    }

    if (!response.ok) {
        const errorBody = await response.text();
        console.error('[Gemini] error response body:', errorBody);
        throw providerError(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw providerError('Gemini returned an empty response.');
    }

    return text.trim();
}

async function generateFromImage({ prompt, imageUrl }) {
    if (!GEMINI_API_KEY) {
        throw providerError('GEMINI_API_KEY is not configured');
    }

    let imageResponse;
    try {
        imageResponse = await fetchWithTimeout(imageUrl, {});
    } catch (err) {
        // Fixes a pre-existing gap: this fetch previously had no try/catch,
        // so a network failure here threw a raw TypeError with no .code —
        // aiController's `err.code === 'AI_PROVIDER_ERROR'` check would
        // miss it and fall through to the generic 500 handler instead of
        // the intended 502 path.
        throw toProviderError(err);
    }

    if (!imageResponse.ok) {
        throw providerError(`Could not fetch image from imageUrl: ${imageResponse.status}`);
    }

    const mimeType = imageResponse.headers.get('content-type') || 'image/jpg';
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    let response;
    try {
        response = await withRetry(() =>
            fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: mimeType, data: base64Data } },
                            ],
                        },
                    ],
                }),
            })
        );
    } catch (err) {
        throw toProviderError(err);
    }

    if (!response.ok) {
        throw providerError(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw providerError('Gemini returned an empty response.');
    }

    return text.trim();
}

module.exports = { generateText, generateFromImage };