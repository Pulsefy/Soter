import * as fs from 'fs';
import * as path from 'path';

export class FixtureHttpProvider {
  private fixtures: Record<string, any> = {};

  constructor(fixtureName: string) {
    const fixturePath = path.join(
      __dirname,
      'fixtures',
      `${fixtureName}.fixture.json`,
    );
    this.fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  }

  get(key: string): any {
    if (!(key in this.fixtures)) {
      throw new Error(
        `[FixtureHttpProvider] No fixture found for key: "${key}"`,
      );
    }
    return this.fixtures[key];
  }
}

// Used in services/tests to check if we're in test mode
export function isTestMode(): boolean {
  return process.env.USE_FIXTURES === 'true';
}
