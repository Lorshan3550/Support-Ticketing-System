import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedPrincipal } from '../../tenancy/tenant-context.types';

/** Injects the authenticated principal that the JWT strategy resolved. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as AuthenticatedPrincipal;
  },
);
