import React from 'react';
import { Rocket } from 'lucide-react';

type ComingSoonProps = {
	title?: string;
};

/**
 * Generic placeholder to highlight upcoming functionality.
 */
export function ComingSoon({ title = 'Coming Soon' }: ComingSoonProps) {
	return (
		<div className="flex flex-col items-center justify-center flex-1 gap-6">
			<div className="relative w-32 h-32 flex items-center justify-center">
				<div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse" />
				<Rocket className="w-16 h-16 text-primary relative z-10" />
			</div>
			<div className="text-center space-y-2">
				<h2 className="text-2xl font-semibold text-foreground">{title}</h2>
				<p className="text-muted-foreground max-w-md">
					We're working hard to bring you something amazing. Stay tuned!
				</p>
			</div>
		</div>
	);
}

