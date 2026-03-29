import { PDFParse } from 'pdf-parse';

import { MAX_TEXT_LENGTH, summarizeText } from './summarize.js';

export const MAX_PDF_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const PDF_AUTO_SUMMARY_THRESHOLD = 2_000;
export const SUPPORTED_PDF_MIME_TYPES = new Set([
    'application/pdf'
]);

function createHttpError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeMimeType(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeBase64Pdf(value) {
    return String(value || '')
        .replace(/^data:application\/pdf;base64,/i, '')
        .replace(/\s+/g, '')
        .trim();
}

function estimateBase64Bytes(base64Value) {
    const normalizedValue = normalizeBase64Pdf(base64Value);
    const paddingLength = normalizedValue.endsWith('==')
        ? 2
        : normalizedValue.endsWith('=')
            ? 1
            : 0;

    return Math.floor((normalizedValue.length * 3) / 4) - paddingLength;
}

function decodeBase64Pdf(base64Value) {
    try {
        return Buffer.from(base64Value, 'base64');
    } catch (error) {
        throw createHttpError('PDF data must be valid base64.', 400);
    }
}

function normalizeExtractedPdfText(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function createSummaryInput(text) {
    const normalizedText = String(text || '').trim();

    if (normalizedText.length <= MAX_TEXT_LENGTH) {
        return normalizedText;
    }

    return normalizedText.slice(0, MAX_TEXT_LENGTH).trimEnd();
}

export async function extractTextFromPdf({ pdfBase64 = '', mimeType = '' } = {}, fetchImpl = fetch) {
    const normalizedMimeType = normalizeMimeType(mimeType);
    const normalizedBase64 = normalizeBase64Pdf(pdfBase64);

    if (!normalizedBase64) {
        throw createHttpError('PDF data is required.', 400);
    }

    if (normalizedMimeType && !SUPPORTED_PDF_MIME_TYPES.has(normalizedMimeType)) {
        throw createHttpError('Use a PDF document.', 400);
    }

    if (estimateBase64Bytes(normalizedBase64) > MAX_PDF_FILE_SIZE_BYTES) {
        throw createHttpError(`PDF must be ${Math.round(MAX_PDF_FILE_SIZE_BYTES / (1024 * 1024))} MB or smaller.`, 400);
    }

    const parser = new PDFParse({
        data: decodeBase64Pdf(normalizedBase64)
    });

    try {
        const textResult = await parser.getText({
            pageJoiner: '\n\n'
        });
        const text = normalizeExtractedPdfText(textResult?.text);
        const pageCount = Number.isFinite(Number(textResult?.total))
            ? Math.max(0, Math.round(Number(textResult.total)))
            : 0;
        let summary = '';

        if (text.length > PDF_AUTO_SUMMARY_THRESHOLD) {
            try {
                summary = await summarizeText(createSummaryInput(text), fetchImpl);
            } catch (error) {
                console.error('Failed to summarize extracted PDF text.', error);
            }
        }

        return {
            text,
            summary,
            pageCount
        };
    } catch (error) {
        throw createHttpError('Could not extract text from that PDF.', error?.statusCode || 400);
    } finally {
        await parser.destroy();
    }
}
