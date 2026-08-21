import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextService } from './tenant-context.service';

/**
 * Opens an AsyncLocalStorage context for every inbound request.
 *
 * This must run before guards (Nest's order is middleware -> guards ->
 * interceptors -> pipes -> handler), because the JWT strategy writes the
 * resolved principal into the store this opens. The store starts empty: an
 * unauthenticated request gets a context with no tenant, and any tenant-scoped
 * query on that path throws rather than running unfiltered.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    this.tenantContext.runWithNewContext(next);
  }
}
