import { promises as fs } from 'fs';
import path from 'path';
import { AppConfig, DEFAULT_CONFIG } from '@/types/config';

const CONFIG_FILE = 'config.json';

export async function getConfig(): Promise<AppConfig> {
  try {
    const configPath = path.join(process.cwd(), CONFIG_FILE);
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_CONFIG,
      ...config,
    };
  } catch (error) {
    // If config doesn't exist or is invalid, return defaults
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = path.join(process.cwd(), CONFIG_FILE);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function validateDirectory(dirPath: string): Promise<{ valid: boolean; absolutePath?: string; error?: string }> {
  try {
    // Convert to absolute path if relative
    const absolutePath = path.isAbsolute(dirPath) 
      ? dirPath 
      : path.join(process.cwd(), dirPath);
    
    // Check if directory exists
    const stats = await fs.stat(absolutePath);
    
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' };
    }
    
    // Check read permissions
    await fs.access(absolutePath, fs.constants.R_OK);
    
    return { valid: true, absolutePath };
  } catch (error) {
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : 'Invalid directory path' 
    };
  }
}
