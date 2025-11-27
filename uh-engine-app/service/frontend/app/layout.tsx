import React from 'react';
import './globals.css';
import { QueryProvider } from '@/lib/query';
import { Archivo } from 'next/font/google';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { ConnectionWarmup } from '@/components/connection-warmup';
import { DeploymentStatusIndicator } from '@/components/deployment-status-indicator';

export const metadata = {
	title: 'Unified Honey',
	description: 'Frontend rebuilt with Next.js',
};

const archivo = Archivo({ 
        subsets: ['latin'],
        variable: '--font-archivo',
        display: 'swap',
        adjustFontFallback: true,
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
                        <body className={`min-h-screen bg-background text-foreground antialiased ${archivo.variable} ${archivo.className} font-sans`}>
				<QueryProvider>
					<ConnectionWarmup />
					<SidebarProvider>
						<AppSidebar />
						<SidebarInset>
							{children}
						</SidebarInset>
						<DeploymentStatusIndicator />
					</SidebarProvider>
				</QueryProvider>
			</body>
		</html>
	);
}

