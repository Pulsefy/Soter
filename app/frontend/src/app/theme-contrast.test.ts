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

describe('ClaimReceipt dark-mode class coverage', () => {
  const claimReceiptSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/ClaimReceipt.tsx'),
    'utf8',
  );

  const STATUS_KEYS = ['requested', 'verified', 'approved', 'disbursed', 'archived'];

  it.each(STATUS_KEYS)(
    'statusColors["%s"] contains dark:bg- and dark:text- variants',
    (status) => {
      const pattern = new RegExp(`${status}:\\s*['"\`]([^'"\`]+)['"\`]`);
      const match = claimReceiptSource.match(pattern);
      expect(match).not.toBeNull();
      expect(match![1]).toMatch(/dark:bg-/);
      expect(match![1]).toMatch(/dark:text-/);
    },
  );

  it.each(STATUS_KEYS)(
    'statusBadgeColors["%s"] contains dark:bg- and dark:text- variants',
    (status) => {
      expect(claimReceiptSource).toMatch(
        new RegExp(`${status}:.*dark:bg-.*dark:text-`),
      );
    },
  );

  it('action buttons carry dark:bg-white/10 and dark:hover:bg-white/20', () => {
    const occurrences = (claimReceiptSource.match(/dark:bg-white\/10/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    const hoverOccurrences = (claimReceiptSource.match(/dark:hover:bg-white\/20/g) || []).length;
    expect(hoverOccurrences).toBeGreaterThanOrEqual(3);
  });

  it('FieldCopyButton carries text-current', () => {
    expect(claimReceiptSource).toContain('text-current');
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

describe('help/page.tsx dark-mode link coverage', () => {
  const helpSource = fs.readFileSync(
    path.join(process.cwd(), 'src/app/[locale]/help/page.tsx'),
    'utf8',
  );

  it('contains dark:hover:text-blue-300 on all three card links', () => {
    const count = (helpSource.match(/dark:hover:text-blue-300/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('contains dark:text-blue-400 on all three card links', () => {
    const count = (helpSource.match(/dark:text-blue-400/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

describe('dashboard/page.tsx dark-mode button coverage', () => {
  const dashboardSource = fs.readFileSync(
    path.join(process.cwd(), 'src/app/[locale]/dashboard/page.tsx'),
    'utf8',
  );

  it('Learn More button carries explicit text-gray-700 and dark:text-gray-200', () => {
    expect(dashboardSource).toContain('text-gray-700');
    expect(dashboardSource).toContain('dark:text-gray-200');
  });
});

describe('campaigns and verification-review dark-mode confirmation', () => {
  it('campaigns/page.tsx contains at least one dark: variant', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/[locale]/campaigns/page.tsx'),
      'utf8',
    );
    expect(src).toMatch(/dark:/);
  });

  it('verification-review components contain at least one dark: variant', () => {
    const vrDir = path.join(process.cwd(), 'src/components/verification-review');
    const combined = readSourceFiles(vrDir).join('\n');
    expect(combined).toMatch(/dark:/);
  });
});
