import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LabReportExtractService } from './extract.service.js';

type UploadedDoc = { buffer: Buffer; originalname: string; mimetype: string };

@Controller('lab')
export class LabReportExtractController {
  constructor(private readonly svc: LabReportExtractService) {}

  /** POST /lab/extract  (multipart field "doc") -> values pulled from the certificate. */
  @Post('extract')
  @UseInterceptors(FileInterceptor('doc', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async extract(@UploadedFile() file?: UploadedDoc): Promise<unknown> {
    if (!file || !file.buffer?.length) {
      return { ok: false, code: 'NO_DOC', message: 'No document uploaded (multipart field "doc").' };
    }
    return { ok: true, data: this.svc.extract(file.buffer) };
  }
}
