/**
 * Helpers that compare a class-validator DTO with the request-body schema the
 * OpenAPI document publishes for it.
 *
 * Three kinds of drift are detected for the top-level properties of a body:
 *
 *  - `undocumented`: the DTO validates (and therefore accepts) a property that
 *    the spec does not list.
 *  - `rejected`: the spec lists a property that the DTO would reject, because
 *    it carries no validation decorator and the global ValidationPipe runs with
 *    `whitelist` + `forbidNonWhitelisted`.
 *  - `required`: the spec's `required` list differs from the properties that
 *    actually fail validation when omitted.
 *
 * Nested objects are compared by property name only; their inner shape is not
 * walked. See docs/openapi-dto-parity.md.
 */
import {
  INestApplication,
  Type,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validate, ValidationError } from 'class-validator';

import { buildSwaggerConfig } from '../../src/swagger-config';

/**
 * Same validator options the global ValidationPipe uses in src/main.ts.
 * `forbidUnknownValues: false` mirrors Nest's own ValidationPipe default;
 * without it class-validator reports one opaque "unknown value" error for DTOs
 * that have no decorators instead of the per-property whitelist errors the
 * running app produces.
 */
export const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: false,
} as const;

export type HttpMethod = 'post' | 'put' | 'patch' | 'delete';

export interface ParityEndpoint {
  method: HttpMethod;
  /** Path exactly as it appears in the OpenAPI document. */
  path: string;
  /** DTO class bound to the endpoint's `@Body()`. */
  dto: Type<object>;
}

export type DriftKind =
  'undocumented' | 'rejected' | 'required' | 'missing-schema';

export interface ParityProblem {
  kind: DriftKind;
  property?: string;
  message: string;
}

interface BodySchema {
  name: string;
  properties: Set<string>;
  required: Set<string>;
}

/**
 * Boots a throw-away Nest app containing only the given controllers (all of
 * their dependencies are auto-mocked) and returns the OpenAPI document built
 * with the production prefix/versioning setup. No database or Redis needed.
 */
export async function buildOpenApiDocument(
  controllers: Type<unknown>[],
): Promise<{ app: INestApplication; document: OpenAPIObject }> {
  const moduleRef = await Test.createTestingModule({ controllers })
    .useMocker(() => ({}))
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      ...VALIDATION_OPTIONS,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();

  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  return { app, document };
}

type SchemaLike = {
  $ref?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  allOf?: SchemaLike[];
};

function resolveRef(
  document: OpenAPIObject,
  schema: SchemaLike,
): { name: string; schema: SchemaLike } {
  let name = '(inline)';
  let current: SchemaLike = schema;
  // Follow chained $refs defensively; the swagger plugin normally emits one.
  for (let i = 0; i < 5 && current.$ref; i += 1) {
    name = current.$ref.replace('#/components/schemas/', '');
    current = document.components?.schemas?.[name] ?? {};
  }
  return { name, schema: current };
}

function collectProperties(
  document: OpenAPIObject,
  schema: SchemaLike,
): { properties: Set<string>; required: Set<string> } {
  const properties = new Set<string>(Object.keys(schema.properties ?? {}));
  const required = new Set<string>(schema.required ?? []);
  for (const part of schema.allOf ?? []) {
    const nested = collectProperties(
      document,
      resolveRef(document, part).schema,
    );
    nested.properties.forEach(p => properties.add(p));
    nested.required.forEach(r => required.add(r));
  }
  return { properties, required };
}

/** Extracts the JSON request-body schema for an operation, or null if absent. */
export function getBodySchema(
  document: OpenAPIObject,
  endpoint: Pick<ParityEndpoint, 'method' | 'path'>,
): BodySchema | null {
  const operation = document.paths?.[endpoint.path]?.[endpoint.method];
  const body = operation?.requestBody as
    { content?: Record<string, { schema?: SchemaLike }> } | undefined;
  const raw = body?.content?.['application/json']?.schema;
  if (!raw) return null;
  const { name, schema } = resolveRef(document, raw);
  const { properties, required } = collectProperties(document, schema);
  return { name, properties, required };
}

/** Property names the DTO declares at least one validator for. */
export function validatedProperties(dto: Type<object>): Set<string> {
  const metadata = getMetadataStorage().getTargetValidationMetadatas(
    dto,
    undefined as never,
    false,
    false,
  );
  return new Set(metadata.map(m => m.propertyName));
}

function errorsFor(
  errors: ValidationError[],
  property: string,
): ValidationError[] {
  return errors.filter(e => e.property === property);
}

/** Properties that fail validation when the payload is empty. */
async function requiredProperties(dto: Type<object>): Promise<Set<string>> {
  const errors = await validate(plainToInstance(dto, {}), VALIDATION_OPTIONS);
  return new Set(errors.map(e => e.property));
}

/** Properties the ValidationPipe would strip/reject as non-whitelisted. */
async function rejectedProperties(
  dto: Type<object>,
  candidates: Iterable<string>,
): Promise<Set<string>> {
  const rejected = new Set<string>();
  for (const property of candidates) {
    const instance = plainToInstance(dto, { [property]: '__parity_probe__' });
    const errors = await validate(instance, VALIDATION_OPTIONS);
    const hit = errorsFor(errors, property).some(
      e => e.constraints && 'whitelistValidation' in e.constraints,
    );
    if (hit) rejected.add(property);
  }
  return rejected;
}

export async function compareDtoToSchema(
  dto: Type<object>,
  schema: BodySchema | null,
): Promise<ParityProblem[]> {
  if (!schema) {
    return [
      {
        kind: 'missing-schema',
        message: `${dto.name}: no application/json request body in the OpenAPI document`,
      },
    ];
  }

  const problems: ParityProblem[] = [];
  const validated = validatedProperties(dto);

  if (schema.name !== dto.name) {
    problems.push({
      kind: 'missing-schema',
      message: `Spec documents the body as "${schema.name}" but the endpoint's DTO is "${dto.name}"`,
    });
  }

  for (const property of validated) {
    if (!schema.properties.has(property)) {
      problems.push({
        kind: 'undocumented',
        property,
        message: `${dto.name}.${property} is accepted by the DTO but missing from the OpenAPI schema`,
      });
    }
  }

  const rejected = await rejectedProperties(dto, schema.properties);
  for (const property of rejected) {
    problems.push({
      kind: 'rejected',
      property,
      message: `${dto.name}.${property} is documented in the OpenAPI schema but rejected by the DTO (no validator, forbidNonWhitelisted)`,
    });
  }

  const dtoRequired = await requiredProperties(dto);
  for (const property of schema.properties) {
    if (rejected.has(property)) continue;
    const specSaysRequired = schema.required.has(property);
    const dtoSaysRequired = dtoRequired.has(property);
    if (specSaysRequired !== dtoSaysRequired) {
      problems.push({
        kind: 'required',
        property,
        message: `${dto.name}.${property}: spec says ${specSaysRequired ? 'required' : 'optional'}, DTO treats it as ${dtoSaysRequired ? 'required' : 'optional'}`,
      });
    }
  }

  return problems;
}

export async function checkEndpoint(
  document: OpenAPIObject,
  endpoint: ParityEndpoint,
): Promise<ParityProblem[]> {
  return compareDtoToSchema(endpoint.dto, getBodySchema(document, endpoint));
}
