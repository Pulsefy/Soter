# OpenAPI request-body parity tests

DTOs are validated with `class-validator` decorators, while the OpenAPI
document is built from `@nestjs/swagger` decorators (`@ApiProperty`,
`@ApiBody`, ...). The two are written independently, so they can silently
drift. `test/openapi-dto-parity.spec.ts` fails when they do.

It runs as part of `npm test` and needs **no database or Redis**: it boots a
throw-away Nest app containing only the registered controllers (their
dependencies are auto-mocked), builds the OpenAPI document with the same
`/api` prefix, URI versioning and swagger config the real app uses, and
compares each registered endpoint's request-body schema with its DTO.

## What is checked

For the top-level properties of each request body:

| Problem | Meaning |
| --- | --- |
| `undocumented` | The DTO has a validator for a property that the spec does not list, so the API accepts a field nobody can discover. Usually a missing `@ApiProperty`. |
| `rejected` | The spec lists a property the DTO has no validator for. With `whitelist` + `forbidNonWhitelisted` the real pipe answers HTTP 422 for it. Usually a missing class-validator decorator. |
| `required` | The spec's `required` list differs from the properties that actually fail validation when omitted (e.g. `@IsOptional()` without `@ApiPropertyOptional`). |
| `missing-schema` | The operation has no `application/json` body, or the body is documented as a different class than the DTO in the registry. |

Validation uses the same options as the global pipe in `src/main.ts`
(`whitelist`, `forbidNonWhitelisted`, and Nest's `forbidUnknownValues: false`).

### Limits

- Only top-level properties are compared. Nested objects are matched by
  property name, not by their inner shape.
- Types, formats and constraints (`@MaxLength`, enum values, ...) are not
  compared, only the set of accepted properties and which are required.
- Query/path parameters are out of scope.

## Adding an endpoint

Edit `test/openapi-parity/registry.ts`:

1. If the endpoint's controller is not in `CONTROLLERS`, import and add it.
2. Add one line to `ENDPOINTS`:

   ```ts
   { method: 'post', path: '/api/v1/claims/{id}/cancel', dto: CancelClaimDto },
   ```

   `path` must match the key in the OpenAPI document exactly (`/api/v1/...`,
   `{id}` style path params). If you are unsure, run the spec: a wrong path
   fails with a `missing-schema` problem.

3. Run `npx jest test/openapi-dto-parity.spec.ts`. Any problem is printed as a
   readable sentence, for example:

   ```
   CreateCampaignDto.sneakyField is accepted by the DTO but missing from the OpenAPI schema
   ```

## Proof that it catches drift

The second `describe` block in the spec defines fixture controllers with one
deliberate mismatch each (extra validated field, documented-but-rejected field,
required/optional disagreement, wrongly documented body, no body) and asserts
that each is reported, plus an in-sync control that must stay clean.
