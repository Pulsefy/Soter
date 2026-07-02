import { Global, Module } from '@nestjs/common';
import { CorrelationPropagationUtil } from '../utils/correlation-propagation.util';
import { OutboundCorrelationInterceptor } from '../interceptors/outbound-correlation.interceptor';

@Global()
@Module({
  providers: [
    {
      provide: CorrelationPropagationUtil,
      useFactory: () => CorrelationPropagationUtil.getInstance(),
    },
    OutboundCorrelationInterceptor,
  ],
  exports: [CorrelationPropagationUtil, OutboundCorrelationInterceptor],
})
export class CorrelationModule {}
