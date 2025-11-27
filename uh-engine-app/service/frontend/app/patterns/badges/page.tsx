import type { ComponentProps, ComponentType } from 'react';

import {
	IconAlertTriangle,
	IconArrowUpRight,
	IconCircleCheckFilled,
	IconCircleDashed,
	IconCircleX,
	IconInfoCircle,
	IconLoader3,
	IconPlus,
} from '@tabler/icons-react';

import { StatusBadge } from '@/components/badges/status-badge';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const primaryStatuses = [
	{
		label: 'Enabled',
		description: 'Primary success state used in Openflow table.',
		tone: 'green',
		icon: IconCircleCheckFilled,
	},
	{
		label: 'Pending',
		description: 'Waiting for processing or manual action.',
		tone: 'blue',
		icon: IconLoader3,
	},
	{
		label: 'Warning',
		description: 'Non-blocking issues, needs attention soon.',
		tone: 'orange',
		icon: IconAlertTriangle,
	},
	{
		label: 'Failed',
		description: 'Blocking errors that require intervention.',
		tone: 'red',
		icon: IconCircleX,
	},
	{
		label: 'Disabled',
		description: 'Explicitly disabled configuration or feature.',
		tone: 'grey',
		icon: IconCircleDashed,
	},
] as const;

const badgeCodes = [
	{ code: 'badge-green-icon-color', label: 'Green – icon colored', tone: 'green', appearance: 'color', indicator: 'icon' },
	{ code: 'badge-green-icon-mono', label: 'Green – icon mono', tone: 'green', appearance: 'mono', indicator: 'icon' },
	{ code: 'badge-green-text-color', label: 'Green – text only colored', tone: 'green', appearance: 'color', indicator: 'none' },
	{ code: 'badge-green-text-mono', label: 'Green – text only mono', tone: 'green', appearance: 'mono', indicator: 'none' },
	{ code: 'badge-green-dot-color', label: 'Green – dot colored', tone: 'green', appearance: 'color', indicator: 'dot' },
	{ code: 'badge-green-dot-mono', label: 'Green – dot mono', tone: 'green', appearance: 'mono', indicator: 'dot' },
	{ code: 'badge-blue-icon-color', label: 'Blue – icon colored', tone: 'blue', appearance: 'color', indicator: 'icon' },
	{ code: 'badge-blue-icon-mono', label: 'Blue – icon mono', tone: 'blue', appearance: 'mono', indicator: 'icon' },
	{ code: 'badge-blue-text-color', label: 'Blue – text only colored', tone: 'blue', appearance: 'color', indicator: 'none' },
	{ code: 'badge-blue-text-mono', label: 'Blue – text only mono', tone: 'blue', appearance: 'mono', indicator: 'none' },
	{ code: 'badge-blue-dot-color', label: 'Blue – dot colored', tone: 'blue', appearance: 'color', indicator: 'dot' },
	{ code: 'badge-blue-dot-mono', label: 'Blue – dot mono', tone: 'blue', appearance: 'mono', indicator: 'dot' },
	{ code: 'badge-orange-icon-color', label: 'Orange – icon colored', tone: 'orange', appearance: 'color', indicator: 'icon' },
	{ code: 'badge-orange-icon-mono', label: 'Orange – icon mono', tone: 'orange', appearance: 'mono', indicator: 'icon' },
	{ code: 'badge-orange-text-color', label: 'Orange – text only colored', tone: 'orange', appearance: 'color', indicator: 'none' },
	{ code: 'badge-orange-text-mono', label: 'Orange – text only mono', tone: 'orange', appearance: 'mono', indicator: 'none' },
	{ code: 'badge-orange-dot-color', label: 'Orange – dot colored', tone: 'orange', appearance: 'color', indicator: 'dot' },
	{ code: 'badge-orange-dot-mono', label: 'Orange – dot mono', tone: 'orange', appearance: 'mono', indicator: 'dot' },
	{ code: 'badge-red-icon-color', label: 'Red – icon colored', tone: 'red', appearance: 'color', indicator: 'icon' },
	{ code: 'badge-red-icon-mono', label: 'Red – icon mono', tone: 'red', appearance: 'mono', indicator: 'icon' },
	{ code: 'badge-red-text-color', label: 'Red – text only colored', tone: 'red', appearance: 'color', indicator: 'none' },
	{ code: 'badge-red-text-mono', label: 'Red – text only mono', tone: 'red', appearance: 'mono', indicator: 'none' },
	{ code: 'badge-red-dot-color', label: 'Red – dot colored', tone: 'red', appearance: 'color', indicator: 'dot' },
	{ code: 'badge-red-dot-mono', label: 'Red – dot mono', tone: 'red', appearance: 'mono', indicator: 'dot' },
	{ code: 'badge-grey-icon-color', label: 'Grey – icon colored', tone: 'grey', appearance: 'color', indicator: 'icon' },
	{ code: 'badge-grey-icon-mono', label: 'Grey – icon mono', tone: 'grey', appearance: 'mono', indicator: 'icon' },
	{ code: 'badge-grey-text-color', label: 'Grey – text only colored', tone: 'grey', appearance: 'color', indicator: 'none' },
	{ code: 'badge-grey-text-mono', label: 'Grey – text only mono', tone: 'grey', appearance: 'mono', indicator: 'none' },
	{ code: 'badge-grey-dot-color', label: 'Grey – dot colored', tone: 'grey', appearance: 'color', indicator: 'dot' },
	{ code: 'badge-grey-dot-mono', label: 'Grey – dot mono', tone: 'grey', appearance: 'mono', indicator: 'dot' },
] as const;

type ButtonVariantName = ComponentProps<typeof Button>['variant'];
type IconComponent = ComponentType<{ className?: string }>;

type ButtonVariantConfig = {
	label: string;
	description: string;
	variant: ButtonVariantName;
	action: string;
	icon?: IconComponent;
	iconPlacement?: 'left' | 'right';
	isIconOnly?: boolean;
};

const buttonVariantConfigs: ButtonVariantConfig[] = [
	{
		label: 'Primary action',
		description: 'Hero call-to-action. Use once per surface for the highest priority task.',
		variant: 'default',
		action: 'Deploy changes',
		icon: IconCircleCheckFilled,
	},
	{
		label: 'Secondary action',
		description: 'Balanced emphasis for supporting decisions and follow-up actions.',
		variant: 'secondary',
		action: 'Schedule sync',
		icon: IconPlus,
	},
	{
		label: 'Outline action',
		description: 'Neutral commands that still need visual affordance in dense layouts.',
		variant: 'outline',
		action: 'View history',
		icon: IconInfoCircle,
	},
	{
		label: 'Ghost action',
		description: 'Low-emphasis, inline actions within cards, tables, or empty states.',
		variant: 'ghost',
		action: 'Preview JSON',
	},
	{
		label: 'Link action',
		description: 'Inline textual actions that navigate users elsewhere.',
		variant: 'link',
		action: 'Learn more',
		icon: IconArrowUpRight,
		iconPlacement: 'right',
	},
	{
		label: 'Destructive action',
		description: 'Irreversible changes, clearly signaling risk and intent.',
		variant: 'destructive',
		action: 'Delete source',
		icon: IconCircleX,
	},
	{
		label: 'Icon only',
		description: 'Square trigger for quick actions like refresh or edit.',
		variant: 'outline',
		action: 'Open menu',
		icon: IconPlus,
		isIconOnly: true,
	},
] as const;

export default function BadgePatternPage() {
	return (
		<div className="flex h-full flex-col">
			<PageHeader title="Badge Lab" group="Design System" />
			<main className="flex-1 space-y-6 overflow-y-auto p-4 lg:p-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Primary Status Tokens</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-4">
						{primaryStatuses.map((status) => (
							<div
								key={status.label}
								className="flex flex-col gap-1 rounded-lg border border-dashed border-muted-foreground/30 p-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<div>
									<p className="text-sm font-medium text-foreground">{status.label}</p>
									<p className="text-xs text-muted-foreground">{status.description}</p>
								</div>
								<div className="flex flex-wrap items-center gap-3">
									<StatusBadge label={status.label} tone={status.tone} icon={status.icon} />
									<StatusBadge label={status.label} tone={status.tone} icon={status.icon} appearance="mono" />
									<StatusBadge label={status.label} tone={status.tone} indicator="dot" />
									<StatusBadge label={status.label} tone={status.tone} indicator="dot" appearance="mono" />
								</div>
							</div>
						))}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Badge Style Codes</CardTitle>
					</CardHeader>
					<CardContent className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-[200px]">Code</TableHead>
									<TableHead>Description</TableHead>
									<TableHead className="w-[200px] text-center">Preview</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{badgeCodes.map((code) => (
									<TableRow key={code.code}>
										<TableCell>
											<code className="rounded bg-muted px-2 py-1 text-xs">{code.code}</code>
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">{code.label}</TableCell>
										<TableCell className="text-center">
											<StatusBadge
												label="Sample"
												tone={code.tone as any}
												appearance={code.appearance as any}
												indicator={code.indicator as any}
												icon={code.indicator === 'icon' ? IconInfoCircle : undefined}
											/>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Button Variants</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-4">
						{buttonVariantConfigs.map((button) => {
							const Icon = button.icon;

							return (
								<div
									key={button.label}
									className="flex flex-col gap-1 rounded-lg border border-dashed border-muted-foreground/30 p-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div>
										<p className="text-sm font-medium text-foreground">{button.label}</p>
										<p className="text-xs text-muted-foreground">{button.description}</p>
									</div>
									<Button
										variant={button.variant}
										size="sm"
										className={button.isIconOnly ? "w-full gap-0 px-2 sm:w-auto" : "w-full gap-1.5 px-2.5 sm:w-auto"}
										aria-label={button.isIconOnly ? button.action : undefined}
									>
										{Icon && button.iconPlacement !== 'right' ? <Icon className="size-4" /> : null}
										{button.isIconOnly ? null : button.action}
										{Icon && button.iconPlacement === 'right' ? <Icon className="size-4" /> : null}
									</Button>
								</div>
							);
						})}
					</CardContent>
				</Card>

			</main>
		</div>
	);
}

