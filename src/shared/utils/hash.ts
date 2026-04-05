import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const hashContent = (content: Buffer | string): string => {
  return createHash('sha256').update(content).digest('hex');
};

export const hashFile = async (filePath: string): Promise<string> => {
  const fileContents = await readFile(filePath);
  return hashContent(fileContents);
};
