import {
  CallHandler,
  ExecutionContext,
  Injectable,
  mixin,
  NestInterceptor,
  Type,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

import { AppException, ERROR_CODES } from '../dto/error-response.dto';

function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap(error => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {});
    return [...own, ...flatten(error.children ?? [], path)];
  });
}

/**
 * Validates the request body against a class-validator DTO and answers HTTP
 * 400 with a readable message when it does not conform.
 *
 * Interceptors run after guards and before pipes. That ordering is what makes
 * this useful for signed webhooks: the HMAC guard authenticates the sender
 * first (401), then this gate checks the *shape* (400), and only then does the
 * body reach the pipes and business logic. The app's global ValidationPipe
 * still runs afterwards and answers 422, so it is not a substitute here.
 *
 * Uses the same rules as the global pipe: unknown properties are rejected.
 */
export function ValidateBody(dto: Type<object>): Type<NestInterceptor> {
  @Injectable()
  class ValidateBodyInterceptor implements NestInterceptor {
    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      const body: unknown = context.switchToHttp().getRequest<Request>().body;

      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new AppException(
          ERROR_CODES.BAD_REQUEST,
          400,
          'Request body must be a JSON object',
        );
      }

      const errors = await validate(plainToInstance(dto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: false,
      });

      if (errors.length > 0) {
        const messages = flatten(errors);
        throw new AppException(
          ERROR_CODES.BAD_REQUEST,
          400,
          `Invalid request body: ${messages.join('; ')}`,
          { errors: messages },
        );
      }

      return next.handle();
    }
  }

  return mixin(ValidateBodyInterceptor);
}
