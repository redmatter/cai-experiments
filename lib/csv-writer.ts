import { existsSync } from 'fs';
import { appendFile } from 'fs/promises';

/**
 * Converts a JavaScript object array into CSV format and appends to file.
 * Automatically handles headers based on whether the file exists.
 */
export async function writeJsonToCsv<T extends Record<string, any>>(
  data: T | T[],
  csvFilePath: string
): Promise<void> {
  const dataArray = Array.isArray(data) ? data : [data];

  if (dataArray.length === 0) {
    console.log('Input data is empty. Skipping append.');
    return;
  }

  const fileExists = existsSync(csvFilePath);
  const fields = Object.keys(dataArray[0]);

  let csvContent = '';

  // Add header row if file doesn't exist
  if (!fileExists) {
    csvContent += fields.join(',') + '\n';
  }

  // Add data rows
  for (const row of dataArray) {
    const values = fields.map(field => {
      const value = row[field];
      // Handle strings with commas or quotes
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value ?? '';
    });
    csvContent += values.join(',') + '\n';
  }

  await appendFile(csvFilePath, csvContent, 'utf8');

  console.log(
    `✅ Successfully appended ${dataArray.length} record(s) to '${csvFilePath}'. ` +
    `(Headers: ${fileExists ? 'EXCLUDED' : 'INCLUDED'})`
  );
}

/**
 * Creates a timestamped filename for output files
 */
export function createTimestampedFileName(
  prefix: string = 'data',
  extension: string = 'csv'
): string {
  const now = new Date();
  const pad = (num: number) => String(num).padStart(2, '0');

  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  const second = pad(now.getSeconds());

  const timestamp = `${year}${month}${day}_${hour}${minute}${second}`;
  return `${prefix}_${timestamp}.${extension}`;
}