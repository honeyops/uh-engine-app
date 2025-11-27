import { ReactNode } from 'react';

// Force all pages in model-catalog to be dynamic
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ModelCatalogLayout({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
