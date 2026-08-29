import PDFDocument from 'pdfkit';
import { createCanvas } from '@napi-rs/canvas';
import { DocumentExtractionService } from './document-extraction.service';

function createTextPdf(text: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument();
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.text(text);
    document.end();
  });
}

describe('DocumentExtractionService', () => {
  it('从真实 PDF 文字层提取文本并记录非计费指标', async () => {
    const service = new DocumentExtractionService();
    const result = await service.extract(
      'application/pdf',
      await createTextPdf('Question bank PDF extraction proof'),
    );

    expect(result).toMatchObject({
      text: expect.stringContaining('Question bank PDF extraction proof'),
      provider: 'pdf-parse',
      metrics: {
        provider: 'pdf-parse',
        language: null,
        cost: 0,
      },
    });
    expect(result.metrics.characterCount).toBeGreaterThan(0);
    expect(result.metrics.approximateTextTokens).toBeGreaterThan(0);
  });

  it('拒绝非白名单 MIME 与空文档', async () => {
    const service = new DocumentExtractionService();
    await expect(
      service.extract('text/plain', Buffer.from('hello')),
    ).rejects.toThrow('Unsupported document MIME type');
    await expect(service.extract('image/png', Buffer.alloc(0))).rejects.toThrow(
      'Uploaded document is empty',
    );
  });

  it('使用预置本地 Tesseract worker 识别真实英文 PNG', async () => {
    const canvas = createCanvas(900, 180);
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, 900, 180);
    context.fillStyle = 'black';
    context.font = 'bold 64px sans-serif';
    context.fillText('OCR PROOF', 40, 110);

    const result = await new DocumentExtractionService().extract(
      'image/png',
      canvas.toBuffer('image/png'),
    );

    expect(result.provider).toBe('tesseract.js');
    expect(result.language).toBe('eng');
    expect(result.text.toUpperCase()).toContain('OCR');
    expect(result.metrics).toMatchObject({
      provider: 'tesseract.js',
      language: 'eng',
      cost: 0,
    });
  }, 120_000);
});
