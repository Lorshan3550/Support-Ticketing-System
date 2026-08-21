import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  Controller,
  Get,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../app.module';
import { AdminOnly, Auth } from './decorators/auth.decorator';
import { Roles } from './decorators/roles.decorator';

const PASSWORD = 'Password123!';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Routes that exist only for these tests. RBAC has no production endpoints
 * wearing it yet — tickets and categories come later — so a fixture is the
 * only way to exercise the guards over real HTTP rather than by poking
 * `canActivate` with a fake `ExecutionContext`.
 */
@Controller('__rbac-test')
class RbacFixtureController {
  @Get('any')
  @Auth()
  any() {
    return { ok: 'any' };
  }

  @Get('staff')
  @Auth(UserRole.agent, UserRole.owner)
  staff() {
    return { ok: 'staff' };
  }

  @Get('owner')
  @Auth(UserRole.owner)
  owner() {
    return { ok: 'owner' };
  }

  @Get('admin')
  @AdminOnly()
  admin() {
    return { ok: 'admin' };
  }
}

/**
 * Proves `@Roles()` works when applied to a CONTROLLER, and that a
 * handler-level `@Roles()` overrides the class default rather than merging
 * with it.
 */
@Controller('__rbac-class')
@Auth()
@Roles(UserRole.owner)
class RbacClassLevelController {
  @Get('inherited')
  inherited() {
    return { ok: 'inherited' };
  }

  @Get('widened')
  @Roles(UserRole.agent, UserRole.owner)
  widened() {
    return { ok: 'widened' };
  }
}

describe('RBAC guards (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let moduleRef: TestingModule;
  let raw: PrismaClient;

  const suffix = randomUUID().slice(0, 8);
  const subdomain = `rbac-${suffix}`;
  let tenantId: string;
  let ownerId: string;

  const tokens: Record<string, string> = {};

  const get = (path: string, token?: string) => {
    const req = request(server).get(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const login = async (path: string, email: string): Promise<string> => {
    const res = await request(server)
      .post(path)
      .send({ subdomain, email, password: PASSWORD })
      .expect(200);
    return (res.body as TokenPair).accessToken;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RbacFixtureController, RbacClassLevelController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    server = app.getHttpServer() as Server;

    raw = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });

    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const tenant = await raw.tenant.create({
      data: { name: subdomain, subdomain },
    });
    tenantId = tenant.id;

    for (const role of [UserRole.owner, UserRole.agent, UserRole.customer]) {
      const user = await raw.user.create({
        data: {
          tenantId,
          email: `${role}@${subdomain}.test`,
          fullName: `${subdomain} ${role}`,
          passwordHash,
          role,
        },
      });
      if (role === UserRole.owner) {
        ownerId = user.id;
      }
    }
    await raw.admin.create({
      data: {
        tenantId,
        email: `admin@${subdomain}.test`,
        fullName: `${subdomain} admin`,
        passwordHash,
      },
    });

    tokens.owner = await login('/auth/login', `owner@${subdomain}.test`);
    tokens.agent = await login('/auth/login', `agent@${subdomain}.test`);
    tokens.customer = await login('/auth/login', `customer@${subdomain}.test`);
    tokens.admin = await login('/admin/auth/login', `admin@${subdomain}.test`);
  });

  afterAll(async () => {
    if (raw) {
      await raw.admin.deleteMany({ where: { tenantId } });
      await raw.user.deleteMany({ where: { tenantId } });
      await raw.tenant.deleteMany({ where: { id: tenantId } });
      await raw.$disconnect();
    }
    await app?.close();
  });

  it('opens the ALS context on fixture routes too', async () => {
    // If the wildcard middleware did not cover these routes, the JWT strategy
    // would fail with TenantContextUnavailableError (500) rather than 200.
    await get('/__rbac-test/any', tokens.owner).expect(200);
  });

  describe('@Auth() with no roles — any authenticated User', () => {
    it.each([['owner'], ['agent'], ['customer']])('allows %s', async (role) => {
      await get('/__rbac-test/any', tokens[role]).expect(200);
    });

    it('rejects an Admin token with 401', async () => {
      await get('/__rbac-test/any', tokens.admin).expect(401);
    });

    it('rejects an anonymous request with 401', async () => {
      await get('/__rbac-test/any').expect(401);
    });
  });

  describe('@Auth(agent, owner)', () => {
    it.each([['owner'], ['agent']])('allows %s', async (role) => {
      await get('/__rbac-test/staff', tokens[role]).expect(200);
    });

    it('rejects a customer with 403, not 401', async () => {
      // Authenticated fine — just not allowed. The status code should say so.
      await get('/__rbac-test/staff', tokens.customer).expect(403);
    });

    it('rejects an Admin token with 401', async () => {
      await get('/__rbac-test/staff', tokens.admin).expect(401);
    });

    it('rejects an anonymous request with 401', async () => {
      await get('/__rbac-test/staff').expect(401);
    });
  });

  describe('@Auth(owner)', () => {
    it('allows owner', async () => {
      await get('/__rbac-test/owner', tokens.owner).expect(200);
    });

    it.each([['agent'], ['customer']])('rejects %s with 403', async (role) => {
      await get('/__rbac-test/owner', tokens[role]).expect(403);
    });
  });

  describe('@AdminOnly()', () => {
    it('allows an Admin', async () => {
      await get('/__rbac-test/admin', tokens.admin).expect(200);
    });

    it.each([['owner'], ['agent'], ['customer']])(
      'rejects a %s User token with 401',
      async (role) => {
        // 401 rather than 403: the admin-jwt strategy rejects the
        // principalType outright, so the request never authenticates at all.
        await get('/__rbac-test/admin', tokens[role]).expect(401);
      },
    );

    it('rejects an anonymous request with 401', async () => {
      await get('/__rbac-test/admin').expect(401);
    });
  });

  describe('@Roles() applied to a controller', () => {
    it('applies the class-level roles to a handler that sets none', async () => {
      await get('/__rbac-class/inherited', tokens.owner).expect(200);
      await get('/__rbac-class/inherited', tokens.agent).expect(403);
    });

    it('lets a handler override the class default rather than merging', async () => {
      await get('/__rbac-class/widened', tokens.agent).expect(200);
      await get('/__rbac-class/widened', tokens.owner).expect(200);
      await get('/__rbac-class/widened', tokens.customer).expect(403);
    });
  });

  describe('Swagger annotations come from the decorator', () => {
    // CLAUDE.md treats Swagger as part of the endpoint, not an afterthought.
    // Bundling the annotations into `@Auth()` means they cannot drift away
    // from the guards actually applied — this pins that they are emitted.
    const operationFor = (path: string) => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().addBearerAuth().build(),
      );
      return document.paths[path].get!;
    };

    it('declares bearer auth and a 401 on every guarded route', () => {
      for (const path of [
        '/__rbac-test/any',
        '/__rbac-test/staff',
        '/__rbac-test/admin',
      ]) {
        const operation = operationFor(path);
        expect(operation.security).toBeDefined();
        expect(operation.responses['401']).toBeDefined();
      }
    });

    it('documents a 403 only where roles actually restrict access', () => {
      expect(operationFor('/__rbac-test/staff').responses['403']).toBeDefined();
      expect(operationFor('/__rbac-test/any').responses['403']).toBeUndefined();
      expect(
        operationFor('/__rbac-test/admin').responses['403'],
      ).toBeUndefined();
    });
  });

  describe('role freshness', () => {
    it('honours a demotion on the next request, with the same unexpired token', async () => {
      // This is what reading the role from the database buys over trusting
      // the JWT's `role` claim. With a claim-based guard the demoted owner
      // would keep elevated access until the access token expired.
      await get('/__rbac-test/owner', tokens.owner).expect(200);

      await raw.user.update({
        where: { id: ownerId },
        data: { role: UserRole.customer },
      });

      await get('/__rbac-test/owner', tokens.owner).expect(403);

      await raw.user.update({
        where: { id: ownerId },
        data: { role: UserRole.owner },
      });

      await get('/__rbac-test/owner', tokens.owner).expect(200);
    });

    it('locks out a deactivated User immediately, with the same token', async () => {
      await raw.user.update({
        where: { id: ownerId },
        data: { isActive: false },
      });

      await get('/__rbac-test/any', tokens.owner).expect(401);

      await raw.user.update({
        where: { id: ownerId },
        data: { isActive: true },
      });
    });
  });
});
