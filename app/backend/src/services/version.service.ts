import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class VersionService {
  getVersionConfig(): any {
    const filePath = join(__dirname, '..', 'config', 'version-config.json');
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  }
}
