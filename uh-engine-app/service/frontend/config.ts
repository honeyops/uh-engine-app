import { z } from 'zod';

const EnvSchema = z.object({
	NEXT_PUBLIC_API_BASE_URL: z.string().url(),
});

const parsed = EnvSchema.safeParse({
	NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});

if (!parsed.success) {
	const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
	throw new Error(`Invalid environment configuration: ${issues}`);
}

export const appConfig = parsed.data;
