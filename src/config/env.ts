import 'dotenv/config';

import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  AGENT_PASSWORD: z.string().min(1).default('demo123'),
  AGENT_NAME: z.string().min(1).max(64).default('小满'),
  AGENT_TOKEN_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(12 * 60 * 60 * 1000),
  DATA_FILE: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n');
  console.error(`环境变量配置无效：\n${details}`);
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..', '..');
const dataFile = parsed.data.DATA_FILE
  ? path.resolve(projectRoot, parsed.data.DATA_FILE)
  : path.join(projectRoot, 'data', 'store.json');

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly agentPassword: string;
  readonly agentName: string;
  readonly agentTokenTtlMs: number;
  readonly dataFile: string;
  readonly publicDir: string;
  readonly projectRoot: string;
}

export const config: AppConfig = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  logLevel: parsed.data.LOG_LEVEL,
  agentPassword: parsed.data.AGENT_PASSWORD,
  agentName: parsed.data.AGENT_NAME,
  agentTokenTtlMs: parsed.data.AGENT_TOKEN_TTL_MS,
  dataFile,
  publicDir: path.join(projectRoot, 'public'),
  projectRoot,
};
