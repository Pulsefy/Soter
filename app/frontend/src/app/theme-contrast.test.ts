import fs from 'node:fs';
import path from 'node:path';

describe('theme contrast CSS guardrails', () => {
  const sourceRoot = path.join(process.cwd(), 'src');
  const globalsCss = fs.readFileSync(
    path.join(process.cwd(), 'src/app/globals.css'),
    'utf8',
  );

  it('sets color-scheme for both themes', () => {
    expect(globalsCss).toContain('color-scheme: light');
    expect(globalsCss).toContain('color-scheme: dark');
  });

  it('binds Tailwind dark variants to the theme class, not the OS preference', () => {
    expect(globalsCss).toContain(
      '@custom-variant dark (&:where(.dark, .dark *));',
    );
  });

  it('provides dark-mode fallbacks for light-only text, background, and border utilities', () => {
    expect(globalsCss).toContain('[class~="text-gray-500"]:not([class*="dark:text-"])');
    expect(globalsCss).toContain('[class~="bg-white"]:not([class*="dark:bg-"])');
    expect(globalsCss).toContain('[class~="border-gray-200"]:not([class*="dark:border-"])');
  });

  it('uses near-black foreground colors in light mode', () => {
    expect(globalsCss).toContain('--foreground: #111827;');
    expect(globalsCss).toContain('--nav-foreground: #111827;');
  });

  it('does not pair dark white text with blue light-mode text for headings/navigation', () => {
    const source = readSourceFiles(sourceRoot).join('\n');

    expect(source).not.toContain('text-blue-900 dark:text-white');
    expect(source).not.toContain('text-blue-900 dark:text-slate-50');
  });
});

function readSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return readSourceFiles(absolute);
    }

    if (!/\.(tsx?|css)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }

    return fs.readFileSync(absolute, 'utf8');
  });
}
