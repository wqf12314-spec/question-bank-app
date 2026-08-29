import { Injectable } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import localEnglishDataImport from '@tesseract.js-data/eng';

const localEnglishData = localEnglishDataImport as {
  langPath: string;
  gzip: boolean;
};

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 50_000;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const OCR_LANGUAGES = new Set(['eng']);

export type ExtractionResult = {
  text: string;
  provider: 'pdf-parse' | 'tesseract.js';
  language?: string;
  metrics: {
    provider: string;
    language: string | null;
    characterCount: number;
    // 这只是文本长度的估算，绝不是某个模型实际计费 token。
    approximateTextTokens: number;
    latencyMs: number;
    cost: 0;
  };
};

@Injectable()
export class DocumentExtractionService {
  async extract(mime: string, content: Buffer): Promise<ExtractionResult> {
    if (content.length === 0) throw new Error('Uploaded document is empty');
    if (content.length > MAX_SOURCE_BYTES) {
      throw new Error('Document exceeds the 20 MiB extraction limit');
    }
    if (mime === 'application/pdf') return this.extractPdf(content);
    if (IMAGE_MIME_TYPES.has(mime)) return this.extractImage(content);
    throw new Error(`Unsupported document MIME type: ${mime}`);
  }

  private async extractPdf(content: Buffer): Promise<ExtractionResult> {
    const startedAt = Date.now();
    // PDF.js 会加载原生画布；只在实际 PDF 任务加载，避免 JSON Worker 留下句柄。
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(content) });
    try {
      const result = await parser.getText();
      return this.result(
        result.text,
        'pdf-parse',
        undefined,
        Date.now() - startedAt,
      );
    } finally {
      await parser.destroy();
    }
  }

  private async extractImage(content: Buffer): Promise<ExtractionResult> {
    const language = this.ocrLanguage();
    const startedAt = Date.now();
    const worker = await createWorker(
      language,
      1,
      language === 'eng'
        ? {
            langPath: localEnglishData.langPath,
            gzip: localEnglishData.gzip,
          }
        : {},
    );
    try {
      const result = await worker.recognize(content);
      return this.result(
        result.data.text,
        'tesseract.js',
        language,
        Date.now() - startedAt,
      );
    } finally {
      await worker.terminate();
    }
  }

  private result(
    rawText: string,
    provider: ExtractionResult['provider'],
    language: string | undefined,
    latencyMs: number,
  ): ExtractionResult {
    // pdf-parse 对空页会返回 `-- 1 of 1 --` 之类的页码标记，不能误当正文。
    const text = rawText
      .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      throw new Error(
        provider === 'pdf-parse'
          ? 'PDF has no extractable text layer; scanned PDFs require a separate OCR workflow'
          : 'OCR did not recognize any text from the image',
      );
    }
    if (text.length > MAX_EXTRACTED_CHARACTERS) {
      throw new Error(
        'Extracted text exceeds the 50,000 character review limit',
      );
    }
    return {
      text,
      provider,
      ...(language ? { language } : {}),
      metrics: {
        provider,
        language: language ?? null,
        characterCount: text.length,
        approximateTextTokens: Math.ceil(text.length / 4),
        latencyMs,
        cost: 0,
      },
    };
  }

  private ocrLanguage() {
    const configured = process.env.OCR_LANGUAGE || 'eng';
    if (!OCR_LANGUAGES.has(configured)) {
      throw new Error(
        'OCR_LANGUAGE must be eng; add a reviewed local language pack before enabling another language',
      );
    }
    return configured;
  }
}
