import { type ComponentType } from 'react';

import { cn } from '@/lib/utils';

type IconComponent = ComponentType<{ className?: string; size?: number }>;

const tonePalette = {
	green: {
		wrapper:
			'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-200',
		icon: 'text-emerald-600 dark:text-emerald-200',
		dot: 'bg-emerald-500 dark:bg-emerald-300',
	},
	orange: {
		wrapper:
			'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-100',
		icon: 'text-amber-600 dark:text-amber-200',
		dot: 'bg-amber-500 dark:bg-amber-300',
	},
	red: {
		wrapper:
			'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100',
		icon: 'text-rose-600 dark:text-rose-200',
		dot: 'bg-rose-500 dark:bg-rose-300',
	},
	blue: {
		wrapper:
			'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-100',
		icon: 'text-sky-600 dark:text-sky-200',
		dot: 'bg-sky-500 dark:bg-sky-300',
	},
	grey: {
		wrapper:
			'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-500/60 dark:bg-slate-600/30 dark:text-slate-100',
		icon: 'text-slate-500 dark:text-slate-200',
		dot: 'bg-slate-500 dark:bg-slate-300',
	},
} as const;

const toneAliases = {
	success: 'green',
	warning: 'orange',
	danger: 'red',
	info: 'blue',
	neutral: 'grey',
	muted: 'grey',
} as const;

const sizeTokens = {
	small: {
		wrapper: 'h-6 px-2 py-0 text-[11px] gap-1.5',
		icon: 14,
	},
	large: {
		wrapper: 'h-7 px-2.5 py-0.5 text-xs gap-1.5',
		icon: 16,
	},
};

const appearanceTokens = {
	color: {
		wrapper: '',
	},
	mono: {
		wrapper: 'border-border text-muted-foreground bg-transparent dark:text-slate-300',
	},
};

type TonePaletteKey = keyof typeof tonePalette;
type ToneAliasKey = keyof typeof toneAliases;
export type StatusBadgeTone = TonePaletteKey | ToneAliasKey;
export type StatusBadgeSize = keyof typeof sizeTokens;
export type StatusBadgeAppearance = keyof typeof appearanceTokens;
export type StatusBadgeIndicator = 'icon' | 'dot' | 'none';

const resolveToneKey = (tone: StatusBadgeTone): TonePaletteKey => {
	if (tone in tonePalette) {
		return tone as TonePaletteKey;
	}
	return toneAliases[tone as ToneAliasKey] ?? 'grey';
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
	label: string;
	tone?: StatusBadgeTone;
	size?: StatusBadgeSize;
	appearance?: StatusBadgeAppearance;
	indicator?: StatusBadgeIndicator;
	icon?: IconComponent;
	iconSize?: number;
	iconPlacement?: 'start' | 'end';
	iconClassName?: string;
}

/**
 * StatusBadge enforces a consistent pill-style badge across the app.
 * It mirrors the Openflow status badge while allowing tone, size, and icon overrides.
 */
export function StatusBadge({
	label,
	tone = 'grey',
	size = 'small',
	appearance = 'color',
	indicator = 'icon',
	icon: Icon,
	iconSize,
	iconPlacement = 'start',
	iconClassName,
	className,
	...props
}: StatusBadgeProps) {
	const toneKey = resolveToneKey(tone);
	const toneClasses = tonePalette[toneKey];
	const sizeClasses = sizeTokens[size];
	const appearanceClasses = appearanceTokens[appearance];

	const iconElement =
		indicator === 'icon' && Icon ? (
			<Icon
				aria-hidden="true"
				size={iconSize ?? sizeClasses.icon}
				className={cn('shrink-0', toneClasses.icon, iconClassName)}
			/>
		) : null;

	const dotElement =
		indicator === 'dot' ? (
			<span
				aria-hidden="true"
				className={cn(
					'h-2 w-2 shrink-0 rounded-full',
					toneClasses.dot,
					iconClassName
				)}
			/>
		) : null;

	const leadingVisual =
		indicator === 'none'
			? null
			: iconPlacement === 'start'
				? iconElement ?? dotElement
				: null;
	const trailingVisual =
		indicator === 'none'
			? null
			: iconPlacement === 'end'
				? iconElement ?? dotElement
				: null;

	return (
		<span
			className={cn(
				'inline-flex items-center rounded-full border font-medium leading-tight tracking-tight',
				'transition-colors duration-200',
				appearance === 'color' ? toneClasses.wrapper : appearanceClasses.wrapper,
				sizeClasses.wrapper,
				className
			)}
			{...props}
		>
			{leadingVisual}
			{label}
			{trailingVisual}
		</span>
	);
}

