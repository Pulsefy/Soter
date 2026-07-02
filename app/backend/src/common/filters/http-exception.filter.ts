import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ValidationError } from 'class-validator';
import { LoggerService } from '../../logger/logger.service';
import {
  ErrorResponseDto,
  ERROR_CODES,
  getErrorCodeFromStatus,
} from '../dto/error-response.dto';

export interface ErrorResponse {
  code: number;
  message: string;
  details?: any;
  traceId?: string;
  timestamp: string;
  path: string;
  errorCode?: string;
  correlationId?: string;
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: any, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = request.headers['x-request-id'] as string | undefined;
    const correlationId = (request as any).correlationId || traceId;

    // Log the error
    this.logger.error(
      `[${traceId ?? 'N/A'}] ${exception.constructor?.name ?? 'UnknownError'} | Status: ${
        exception.status || HttpStatus.INTERNAL_SERVER_ERROR
      } | Message: ${exception.message} | Path: ${request.url}`,
      exception.stack,
      'AllExceptionsFilter',
    );

    let errorResponse: ErrorResponse;

    if (exception instanceof HttpException) {
      errorResponse = this.handleHttpException(
        exception,
        request,
        traceId,
        correlationId,
      );
    } else if (this.isPrismaError(exception)) {
      errorResponse = this.handlePrismaError(
        exception,
        request,
        traceId,
        correlationId,
      );
    } else if (
      Array.isArray(exception) &&
      exception.some(e => e instanceof ValidationError)
    ) {
      errorResponse = this.handleValidationErrors(
        exception,
        request,
        traceId,
        correlationId,
      );
    } else {
      errorResponse = this.handleGenericError(
        exception,
        request,
        traceId,
        correlationId,
      );
    }

    // Ensure response uses standardized error envelope
    const finalResponse: ErrorResponseDto = {
      code: errorResponse.code,
      message: errorResponse.message,
      traceId: errorResponse.traceId,
      timestamp: errorResponse.timestamp || new Date().toISOString(),
      path: errorResponse.path || request.url,
      details: errorResponse.details,
      errorCode:
        errorResponse.errorCode || getErrorCodeFromStatus(errorResponse.code),
      correlationId: errorResponse.correlationId,
    };

    response.status(finalResponse.code).json(finalResponse);
  }

  private handleHttpException(
    exception: HttpException,
    request: Request,
    traceId?: string,
    correlationId?: string,
  ): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();
    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any).message || exception.message;

    return {
      code: status,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      details:
        typeof exceptionResponse === 'object' ? exceptionResponse : undefined,
      traceId,
      timestamp: new Date().toISOString(),
      path: request.url,
      errorCode: getErrorCodeFromStatus(status),
      correlationId,
    };
  }

  private isPrismaError(exception: any): boolean {
    return (
      exception?.constructor?.name?.includes('Prisma') ||
      exception?.clientVersion ||
      exception?.meta?.target ||
      exception?.code?.startsWith('P')
    );
  }

  private handlePrismaError(
    exception: any,
    request: Request,
    traceId?: string,
    correlationId?: string,
  ): ErrorResponse {
    let code = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error occurred';
    let details: any = null;
    let errorCode: string = ERROR_CODES.DATABASE_ERROR;

    // Map common Prisma errors
    if (exception.code === 'P2002') {
      // Unique constraint failed
      code = HttpStatus.CONFLICT;
      message = 'Unique constraint violation';
      errorCode = ERROR_CODES.UNIQUE_CONSTRAINT_VIOLATION;
      details = {
        target: exception.meta?.target,
        field: Array.isArray(exception.meta?.target)
          ? exception.meta.target.join(', ')
          : exception.meta?.target,
      };
    } else if (exception.code === 'P2025') {
      // Record not found
      code = HttpStatus.NOT_FOUND;
      message = 'Record not found';
      errorCode = ERROR_CODES.RECORD_NOT_FOUND;
      details = {
        cause: exception.meta?.cause,
      };
    } else if (exception.code === 'P2003') {
      // Foreign key constraint failed
      code = HttpStatus.BAD_REQUEST;
      message = 'Foreign key constraint violation';
      errorCode = ERROR_CODES.FOREIGN_KEY_VIOLATION;
      details = {
        field_name: exception.meta?.field_name,
      };
    } else if (exception.code === 'P2000') {
      // Value too long for column
      code = HttpStatus.BAD_REQUEST;
      message = 'Value too long for column';
      errorCode = ERROR_CODES.VALUE_TOO_LONG;
      details = {
        column_name: exception.meta?.column_name,
      };
    } else {
      details = {
        code: exception.code,
        meta: exception.meta,
      };
    }

    return {
      code,
      message,
      details,
      traceId,
      timestamp: new Date().toISOString(),
      path: request.url,
      errorCode,
      correlationId,
    };
  }

  private handleValidationErrors(
    exceptions: ValidationError[],
    request: Request,
    traceId?: string,
    correlationId?: string,
  ): ErrorResponse {
    const validationErrors = exceptions.map(error => ({
      property: error.property,
      value: error.value,
      constraints: error.constraints,
      children: error.children?.length
        ? this.formatChildren(error.children)
        : undefined,
    }));

    return {
      code: HttpStatus.UNPROCESSABLE_ENTITY,
      message: 'Validation failed',
      details: {
        errors: validationErrors,
      },
      traceId,
      timestamp: new Date().toISOString(),
      path: request.url,
      errorCode: ERROR_CODES.VALIDATION_ERROR,
      correlationId,
    };
  }

  private formatChildren(children: ValidationError[]): any[] {
    return children.map(child => ({
      property: child.property,
      value: child.value,
      constraints: child.constraints,
      children: child.children?.length
        ? this.formatChildren(child.children)
        : undefined,
    }));
  }

  private handleGenericError(
    exception: any,
    request: Request,
    traceId?: string,
    correlationId?: string,
  ): ErrorResponse {
    return {
      code: HttpStatus.INTERNAL_SERVER_ERROR,
      message: exception.message || 'Internal server error',
      details: {
        error_type: exception.constructor?.name,
        ...(typeof process !== 'undefined' &&
          process.env.NODE_ENV === 'development' && {
            stack: exception.stack,
          }),
      },
      traceId,
      timestamp: new Date().toISOString(),
      path: request.url,
      errorCode: ERROR_CODES.INTERNAL_SERVER_ERROR,
      correlationId,
    };
  }
}
