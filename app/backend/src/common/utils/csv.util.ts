export class CsvUtil {
  /**
   * Generates a CSV string from an array of objects.
   * @param data Array of objects to convert to CSV.
   * @param headers Optional array of header names. If not provided, keys from the first object will be used.
   * @param excludeFields Optional array of field names to exclude from the CSV.
   */
  static generateCsv(
    data: any[],
    headers?: string[],
    excludeFields: string[] = [],
  ): string {
    if (!data || data.length === 0) {
      return headers ? headers.join(',') : '';
    }

    const keys = Object.keys(data[0]).filter((key) => !excludeFields.includes(key));
    const csvHeaders = headers || keys;

    const csvRows = [csvHeaders.join(',')];

    for (const row of data) {
      const values = keys.map((key) => {
        const val = row[key];
        const escaped = ('' + (val ?? '')).replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
  }
}
