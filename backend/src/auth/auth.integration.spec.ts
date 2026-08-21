import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../app.module';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
}

interface ErrorBody {
  message: string | string[];
}

const PASSWORD = 'Password123!';

/**
 * HTTP-level tests for the two login flows. Covers the three boundaries that
 * matter: tenant isolation, the `User`/`Admin` principal split, and the
 * access/refresh token split.
 */
describe('auth (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let moduleRef: TestingModule;
  let raw: PrismaClient;

  const suffix = randomUUID().slice(0, 8);
  const subA = `autha-${suffix}`;
  const subB = `authb-${suffix}`;

  let tenantA: string;
  let tenantB: string;
  let userB: string;

  const login = (
    path: string,
    subdomain: string,
    email: string,
    password = PASSWORD,
  ) => request(server).post(path).send({ subdomain, email, password });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    server = app.getHttpServer() as Server;

    raw = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });

    const passwordHash = await bcrypt.hash(PASSWORD, 4);

    const makeTenant = async (subdomain: string) => {
      const tenant = await raw.tenant.create({
        data: { name: subdomain, subdomain },
      });
      const user = await raw.user.create({
        data: {
          tenantId: tenant.id,
          email: `agent@${subdomain}.test`,
          fullName: `${subdomain} agent`,
          passwordHash,
          role: UserRole.agent,
        },
      });
      await raw.admin.create({
        data: {
          tenantId: tenant.id,
          email: `admin@${subdomain}.test`,
          fullName: `${subdomain} admin`,
          passwordHash,
        },
      });
      return { tenantId: tenant.id, userId: user.id };
    };

    ({ tenantId: tenantA } = await makeTenant(subA));
    ({ tenantId: tenantB, userId: userB } = await makeTenant(subB));
  });

  afterAll(async () => {
    if (raw) {
      const ids = { in: [tenantA, tenantB] };
      await raw.admin.deleteMany({ where: { tenantId: ids } });
      await raw.user.deleteMany({ where: { tenantId: ids } });
      await raw.tenant.deleteMany({
        where: { id: { in: [tenantA, tenantB] } },
      });
      await raw.$disconnect();
    }
    await app?.close();
  });

  describe('POST /auth/login', () => {
    it('issues an access/refresh pair for a valid User', async () => {
      const res = await login('/auth/login', subA, `agent@${subA}.test`).expect(
        200,
      );

      const body = res.body as TokenPair;
      expect(body.tokenType).toBe('Bearer');
      expect(typeof body.accessToken).toBe('string');
      expect(typeof body.refreshToken).toBe('string');
    });

    it('rejects a valid email belonging to a different tenant', async () => {
      // The credentials are real — just not in this tenant. The lookup runs
      // inside tenant A's scope, so tenant B's user is simply not there.
      await login('/auth/login', subA, `agent@${subB}.test`).expect(401);
    });

    it('returns the same 401 for an unknown tenant as for a bad password', async () => {
      const unknownTenant = await login(
        '/auth/login',
        `nope-${suffix}`,
        `agent@${subA}.test`,
      );
      const badPassword = await login(
        '/auth/login',
        subA,
        `agent@${subA}.test`,
        'wrong',
      );

      expect(unknownTenant.status).toBe(401);
      expect(badPassword.status).toBe(401);
      expect((unknownTenant.body as ErrorBody).message).toBe(
        (badPassword.body as ErrorBody).message,
      );
    });

    it('rejects an Admin trying to log in through the User endpoint', async () => {
      await login('/auth/login', subA, `admin@${subA}.test`).expect(401);
    });

    it('validates the body', async () => {
      await request(server)
        .post('/auth/login')
        .send({ subdomain: subA })
        .expect(400);
    });
  });

  describe('POST /admin/auth/login', () => {
    it('issues tokens for a valid Admin', async () => {
      await login('/admin/auth/login', subA, `admin@${subA}.test`).expect(200);
    });

    it('rejects a User trying to log in through the Admin endpoint', async () => {
      await login('/admin/auth/login', subA, `agent@${subA}.test`).expect(401);
    });
  });

  describe('principal separation', () => {
    let userToken: string;
    let adminToken: string;

    beforeAll(async () => {
      userToken = (
        (await login('/auth/login', subA, `agent@${subA}.test`))
          .body as TokenPair
      ).accessToken;
      adminToken = (
        (await login('/admin/auth/login', subA, `admin@${subA}.test`))
          .body as TokenPair
      ).accessToken;
    });

    it('resolves the User principal on /auth/me', async () => {
      const res = await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body).toMatchObject({
        tenantId: tenantA,
        email: `agent@${subA}.test`,
        role: UserRole.agent,
        principalType: 'user',
      });
    });

    it('rejects a User token on an Admin route', async () => {
      await request(server)
        .get('/admin/auth/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(401);
    });

    it('rejects an Admin token on a User route', async () => {
      await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(401);
    });

    it('rejects a missing token', async () => {
      await request(server).get('/auth/me').expect(401);
    });
  });

  describe('tenant isolation at the guard', () => {
    it('rejects a validly signed token that names one tenant and another tenant user', async () => {
      // Worst case: the signing key itself leaked. The principal lookup still
      // runs through the scoped client, so tenant A's claim cannot resolve
      // tenant B's user and authentication fails.
      const forged = jwt.sign(
        {
          sub: userB,
          tenantId: tenantA,
          principalType: 'user',
          email: `agent@${subB}.test`,
          tokenType: 'access',
          role: UserRole.agent,
        },
        process.env.JWT_ACCESS_SECRET!,
        { expiresIn: '5m' },
      );

      await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });
  });

  describe('token type separation', () => {
    let tokens: { accessToken: string; refreshToken: string };

    beforeAll(async () => {
      tokens = (await login('/auth/login', subA, `agent@${subA}.test`))
        .body as {
        accessToken: string;
        refreshToken: string;
      };
    });

    it('will not accept a refresh token as a bearer credential', async () => {
      await request(server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${tokens.refreshToken}`)
        .expect(401);
    });

    it('will not accept an access token at /auth/refresh', async () => {
      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: tokens.accessToken })
        .expect(401);
    });

    it('exchanges a refresh token for a new pair', async () => {
      const res = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      expect(typeof (res.body as TokenPair).accessToken).toBe('string');
    });

    it('will not accept an Admin refresh token at the User refresh endpoint', async () => {
      const adminTokens = (
        await login('/admin/auth/login', subA, `admin@${subA}.test`)
      ).body as TokenPair;

      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken: adminTokens.refreshToken })
        .expect(401);
    });

    it('stops refreshing once the principal is deactivated', async () => {
      const throwaway = await raw.user.create({
        data: {
          tenantId: tenantA,
          email: `temp-${suffix}@${subA}.test`,
          fullName: 'temp',
          passwordHash: await bcrypt.hash(PASSWORD, 4),
          role: UserRole.customer,
        },
      });

      const { refreshToken } = (
        await login('/auth/login', subA, throwaway.email)
      ).body as TokenPair;

      await raw.user.update({
        where: { id: throwaway.id },
        data: { isActive: false },
      });

      await request(server)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      await raw.user.delete({ where: { id: throwaway.id } });
    });
  });
});
