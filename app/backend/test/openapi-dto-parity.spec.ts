/**
 * Request-body parity: class-validator DTOs vs. the OpenAPI document.
 *
 * Part 1 checks a representative set of real endpoints (openapi-parity/registry.ts).
 * Part 2 proves the check actually catches drift by introducing deliberate
 * mismatches in throw-away fixture controllers.
 *
 * No database or Redis is required; controller dependencies are auto-mocked.
 */
import type { INestApplication } from '@nestjs/common';
import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import { ApiBody, ApiProperty } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { SendReceiptShareDto } from '../src/claims/dto/claim-receipt.dto';
import {
  buildOpenApiDocument,
  checkEndpoint,
  getBodySchema,
  type ParityEndpoint,
} from './openapi-parity/dto-parity';
import { CONTROLLERS, ENDPOINTS } from './openapi-parity/registry';

describe('OpenAPI request-body parity (real endpoints)', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    ({ app, document } = await buildOpenApiDocument(CONTROLLERS));
  });

  afterAll(async () => {
    await app.close();
  });

  it('registry has no duplicate method+path entries', () => {
    const keys = ENDPOINTS.map(e => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(
    ENDPOINTS.map(e => [`${e.method.toUpperCase()} ${e.path}`, e] as const),
  )('%s: DTO and OpenAPI schema agree', async (_label, endpoint) => {
    const problems = await checkEndpoint(document, endpoint);
    expect(problems.map(p => p.message)).toEqual([]);
  });
});

// Regression: SendReceiptShareDto had no validators, so the global
// whitelist/forbidNonWhitelisted pipe rejected every body with HTTP 422.
describe('POST /claims/{id}/receipt/share body (regression)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    errorHttpStatusCode: 422,
  });
  const run = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: SendReceiptShareDto });

  it('accepts a valid email share request', async () => {
    await expect(
      run({
        channel: 'email',
        emailAddresses: ['a@example.com'],
        message: 'hi',
      }),
    ).resolves.toMatchObject({ channel: 'email' });
  });

  it('accepts a valid sms share request', async () => {
    await expect(
      run({ channel: 'sms', phoneNumbers: ['+1234567890'] }),
    ).resolves.toMatchObject({ channel: 'sms' });
  });

  it('rejects an unknown channel', async () => {
    await expect(run({ channel: 'pigeon' })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('rejects malformed email addresses', async () => {
    await expect(
      run({ channel: 'email', emailAddresses: ['not-an-email'] }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

// ---------------------------------------------------------------------------
// Deliberate mismatches: the check must fail on each of these.
// ---------------------------------------------------------------------------

/** Documented *and* validated: the control case that must stay clean. */
class InSyncDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

/** `secret` is validated (so accepted) but has no @ApiProperty. */
class ExtraFieldDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @IsString()
  secret!: string;
}

/** `ghost` is documented but has no validator, so the pipe rejects it. */
class GhostFieldDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty({ required: false })
  ghost?: string;
}

/** Spec says `title` is optional, but the DTO requires it. */
class RequiredDriftDto {
  @ApiProperty({ required: false })
  @IsString()
  title!: string;
}

/** Body documented as a different class than the one the handler binds. */
class WrongDocumentedDto {
  @ApiProperty()
  @IsString()
  other!: string;
}

@Controller('parity-fixtures')
class FixtureController {
  @Post('in-sync')
  inSync(@Body() _dto: InSyncDto) {}

  @Post('extra-field')
  extraField(@Body() _dto: ExtraFieldDto) {}

  @Post('ghost-field')
  ghostField(@Body() _dto: GhostFieldDto) {}

  @Post('required-drift')
  requiredDrift(@Body() _dto: RequiredDriftDto) {}

  @Post('wrong-documented')
  @ApiBody({ type: WrongDocumentedDto })
  wrongDocumented(@Body() _dto: ExtraFieldDto) {}

  @Post('no-body')
  noBody() {}
}

describe('OpenAPI request-body parity (deliberate mismatches are caught)', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  const endpoint = (
    path: string,
    dto: ParityEndpoint['dto'],
  ): ParityEndpoint => ({
    method: 'post',
    path: `/api/v1/parity-fixtures/${path}`,
    dto,
  });

  beforeAll(async () => {
    ({ app, document } = await buildOpenApiDocument([FixtureController]));
  });

  afterAll(async () => {
    await app.close();
  });

  it('control: an in-sync DTO reports no problems', async () => {
    expect(
      await checkEndpoint(document, endpoint('in-sync', InSyncDto)),
    ).toEqual([]);
  });

  it('flags a DTO field that the spec does not document', async () => {
    const problems = await checkEndpoint(
      document,
      endpoint('extra-field', ExtraFieldDto),
    );
    expect(problems).toEqual([
      expect.objectContaining({ kind: 'undocumented', property: 'secret' }),
    ]);
  });

  it('flags a documented field that the DTO would reject', async () => {
    const problems = await checkEndpoint(
      document,
      endpoint('ghost-field', GhostFieldDto),
    );
    expect(problems).toEqual([
      expect.objectContaining({ kind: 'rejected', property: 'ghost' }),
    ]);
  });

  it('flags required/optional disagreement', async () => {
    const problems = await checkEndpoint(
      document,
      endpoint('required-drift', RequiredDriftDto),
    );
    expect(problems).toEqual([
      expect.objectContaining({ kind: 'required', property: 'title' }),
    ]);
  });

  it('flags a body documented as a different schema than the DTO', async () => {
    const problems = await checkEndpoint(
      document,
      endpoint('wrong-documented', ExtraFieldDto),
    );
    expect(problems.map(p => p.kind)).toContain('missing-schema');
  });

  it('flags an endpoint with no documented request body', async () => {
    const problems = await checkEndpoint(
      document,
      endpoint('no-body', InSyncDto),
    );
    expect(problems).toEqual([
      expect.objectContaining({ kind: 'missing-schema' }),
    ]);
    expect(getBodySchema(document, endpoint('no-body', InSyncDto))).toBeNull();
  });
});
