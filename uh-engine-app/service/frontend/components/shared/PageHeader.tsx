import React from 'react';

interface PageHeaderProps {
	title: string;
	group?: string;
	children?: React.ReactNode;
}

export function PageHeader({ title, group, children }: PageHeaderProps) {
	return (
		<header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
			<div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
				{group ? (
					<div className="flex items-center gap-2">
						<span className="text-base font-medium text-muted-foreground">{group}</span>
						<span className="text-base font-medium text-muted-foreground">&gt;</span>
						<h1 className="text-base font-medium">{title}</h1>
					</div>
				) : (
					<h1 className="text-base font-medium">{title}</h1>
				)}
				<div className="ml-auto flex items-center gap-2">
					{children}
				</div>
			</div>
		</header>
	);
}
