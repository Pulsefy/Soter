import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { SorobanService } from './soroban.service';

@Controller('soroban')
export class SorobanController {
  constructor(private readonly sorobanService: SorobanService) {}

  @Post('create')
  async createAidPackage(@Body() body: { recipient: string; amount: number; expiresAt: number }) {
    return this.sorobanService.createAidPackage(body);
  }

  @Post('claim/:id')
  async claimAidPackage(@Param('id') packageId: string) {
    return this.sorobanService.claimAidPackage(packageId);
  }

  @Get(':id')
  async getAidPackage(@Param('id') packageId: string) {
    return this.sorobanService.getAidPackage(packageId);
  }

  @Get('count')
  async getAidPackageCount() {
    return this.sorobanService.getAidPackageCount();
  }
}