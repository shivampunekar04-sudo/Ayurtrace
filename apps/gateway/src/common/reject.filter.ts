import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { REJECT_MESSAGES, type Rejected } from '@ayurtrace/contracts';
import { isLedgerReject } from './reject.js';

/**
 * Converts every failure into the uniform typed contract:
 *  - a business reject → 422 with { ok:false, code, message, detail } (frozen §6.2 code)
 *  - a validation error → 400 with a ZONE-agnostic VALIDATION shape
 *  - anything else → 500, logged
 * Frontends map `code` → REJECT_MESSAGES without parsing prose.
 */
@Catch()
export class RejectFilter implements ExceptionFilter {
  private readonly log = new Logger('Reject');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (isLedgerReject(exception)) {
      const body: Rejected = {
        ok: false,
        code: exception.code,
        message: REJECT_MESSAGES[exception.code] ?? exception.code,
        detail: exception.detail,
      };
      res.status(HttpStatus.UNPROCESSABLE_ENTITY).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      res.status(status).json({ ok: false, code: 'VALIDATION', message: 'Request failed validation.', detail: payload });
      return;
    }

    this.log.error(exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, code: 'INTERNAL', message: 'Unexpected error.' });
  }
}
