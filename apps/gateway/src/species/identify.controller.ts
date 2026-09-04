import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SpeciesIdentifyService } from './identify.service.js';

type UploadedImage = { buffer: Buffer; originalname: string; mimetype: string };

@Controller('species')
export class SpeciesIdentifyController {
  constructor(private readonly svc: SpeciesIdentifyService) {}

  /** POST /species/identify  (multipart: field "image") -> recognised species. */
  @Post('identify')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async identify(@UploadedFile() file?: UploadedImage): Promise<unknown> {
    if (!file || !file.buffer?.length) {
      return { ok: false, code: 'NO_IMAGE', message: 'No image uploaded (multipart field "image").' };
    }
    return { ok: true, data: await this.svc.identify(file.buffer, file.originalname, file.mimetype) };
  }
}
