"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";
import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Database,
	Box,
	AlertCircle,
	TrendingUp,
	Layers
} from "lucide-react";
import { Bar, BarChart, Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
	ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { StatusBadge } from "@/components/badges/status-badge";

type DashboardMode = "modelling" | "timeseries";

interface ModellingMetrics {
	connected_sources: number;
	storage_objects: {
		attributes: number;
		edges: number;
		nodes: number;
		total: number;
	};
	deployed_models: {
		dimensions: number;
		facts: number;
		total: number;
	};
	governance: {
		objects_without_steward: number;
		total_objects: number;
		steward_coverage_percentage: number;
	};
	database: string;
}

// Static placeholder data
const STATIC_METRICS: ModellingMetrics = {
	connected_sources: 13,
	storage_objects: {
		attributes: 13,
		edges: 21,
		nodes: 11,
		total: 45
	},
	deployed_models: {
		dimensions: 6,
		facts: 4,
		total: 10
	},
	governance: {
		objects_without_steward: 55,
		total_objects: 55,
		steward_coverage_percentage: 0
	},
	database: "UNIFIED_HONEY"
};

export default function Page() {
	const [mode, setMode] = useState<DashboardMode>("modelling");
	const [metrics] = useState<ModellingMetrics>(STATIC_METRICS);
	const [loading] = useState(false);
	const [error] = useState<string | null>(null);

	const fetchModellingMetrics = () => {
		// Static data - no fetching needed
	};

	return (
		<>
			<PageHeader title="Dashboard" />
			<div className="flex flex-1 flex-col gap-6 p-6">
				{/* Mode Toggle and Engine Status */}
				<div className="flex justify-between items-center">
					<div className="flex gap-2 items-center">
						<Button
							variant={mode === "modelling" ? "default" : "outline"}
							onClick={() => setMode("modelling")}
						>
							<Database className="w-4 h-4 mr-2" />
							Modelling
						</Button>
						<Button
							variant={mode === "timeseries" ? "default" : "outline"}
							onClick={() => setMode("timeseries")}
						>
							<TrendingUp className="w-4 h-4 mr-2" />
							Time Series
						</Button>
					</div>
					{/* Engine Status Badge */}
					<StatusBadge label="Engine Active" tone="success" indicator="dot" size="large" />
				</div>

				{/* Content */}
				{mode === "timeseries" ? (
					<ComingSoon title="Time Series Dashboard Coming Soon" />
				) : (
					<ModellingDashboard
						metrics={metrics}
						loading={loading}
						error={error}
						onRefresh={fetchModellingMetrics}
					/>
				)}
			</div>
		</>
	);
}

function ModellingDashboard({
	metrics,
	loading,
	error,
	onRefresh
}: {
	metrics: ModellingMetrics | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
}) {
	if (error) {
		return (
			<Card className="border-destructive">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-destructive">
						<AlertCircle className="w-5 h-5" />
						Error Loading Metrics
					</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground mb-4">{error}</p>
					<Button onClick={onRefresh} size="sm">Retry</Button>
				</CardContent>
			</Card>
		);
	}

	if (loading && !metrics) {
		return <MetricsSkeleton />;
	}

	if (!metrics) {
		return null;
	}

	return (
		<div className="grid gap-6">
			{/* Key Metrics Grid - 4 tiles across */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{/* Staging Count */}
				<Card className="bg-gradient-to-br from-background to-muted/20 border-primary/10">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">Staging Count</CardTitle>
						<div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
							<Database className="h-4 w-4 text-primary" />
						</div>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-primary">{metrics.connected_sources}</div>
						<p className="text-xs text-muted-foreground mt-1">
							Stage views deployed
						</p>
					</CardContent>
				</Card>

				{/* Storage Objects */}
				<Card className="bg-gradient-to-br from-background to-muted/20 border-primary/10">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">Storage Objects</CardTitle>
						<div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
							<Box className="h-4 w-4 text-primary" />
						</div>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-primary">{metrics.storage_objects.total}</div>
						<p className="text-xs text-muted-foreground mt-1">
							{metrics.storage_objects.attributes} attrs • {metrics.storage_objects.edges} edges • {metrics.storage_objects.nodes} nodes
						</p>
					</CardContent>
				</Card>

				{/* Modelling Objects */}
				<Card className="bg-gradient-to-br from-background to-muted/20 border-primary/10">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">Modelling Objects</CardTitle>
						<div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
							<Layers className="h-4 w-4 text-primary" />
						</div>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-primary">{metrics.deployed_models.total}</div>
						<p className="text-xs text-muted-foreground mt-1">
							{metrics.deployed_models.dimensions} dimensions • {metrics.deployed_models.facts} facts
						</p>
					</CardContent>
				</Card>

				{/* Objects Without Steward */}
				<Card className="bg-gradient-to-br from-background to-destructive/5 border-destructive/20">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">Without Stewards</CardTitle>
						<div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center">
							<AlertCircle className="h-4 w-4 text-destructive" />
						</div>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-destructive">{metrics.governance.objects_without_steward}</div>
						<p className="text-xs text-muted-foreground mt-1">
							{metrics.governance.steward_coverage_percentage}% coverage
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Rows Processed Per Day - Full Width */}
			<Card className="bg-gradient-to-br from-background to-muted/20">
				<CardHeader>
					<CardTitle>Rows Processed Per Day</CardTitle>
					<CardDescription>Daily data processing volume over time</CardDescription>
				</CardHeader>
				<CardContent className="pt-6">
					<RowsProcessedChart />
				</CardContent>
			</Card>

			{/* Queries Per Day and Top Users */}
			<div className="grid gap-6 md:grid-cols-3">
				{/* Queries Per Day - 2/3 width */}
				<Card className="bg-gradient-to-br from-background to-muted/20 md:col-span-2">
					<CardHeader>
						<CardTitle>Queries Per Day</CardTitle>
						<CardDescription>Daily query volume over time</CardDescription>
					</CardHeader>
					<CardContent className="pt-6">
						<QueriesPerDayChart />
					</CardContent>
				</Card>

				{/* Top Users - 1/3 width */}
				<Card className="bg-gradient-to-br from-background to-muted/20">
					<CardHeader>
						<CardTitle>Top 10 Consumers</CardTitle>
						<CardDescription>By query count</CardDescription>
					</CardHeader>
					<CardContent>
						<TopUsersTable />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

const chartConfig = {
	rows: {
		label: "Rows Processed",
		color: "hsl(var(--primary))",
	},
} satisfies ChartConfig;

function RowsProcessedChart() {
	const [timeRange, setTimeRange] = useState<'7days' | '30days' | '3months'>('30days');

	// Generate static placeholder data based on time range
	const chartData = useMemo(() => {
		const data = [];
		const today = new Date();
		const days = timeRange === '7days' ? 7 : timeRange === '30days' ? 30 : 90;

		for (let i = days - 1; i >= 0; i--) {
			const date = new Date(today);
			date.setDate(date.getDate() - i);
			const dayOfWeek = date.getDay();
			const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

			// Weekend: 200-300, Weekday: 2000-4000
			const min = isWeekend ? 200 : 2000;
			const max = isWeekend ? 300 : 4000;
			const rows = Math.floor(Math.random() * (max - min + 1)) + min;

			data.push({
				date: date.toISOString().split('T')[0],
				rows,
			});
		}

		return data;
	}, [timeRange]);

	const total = useMemo(
		() => chartData.reduce((acc, curr) => acc + curr.rows, 0),
		[chartData]
	);

	return (
		<div className="space-y-4">
			{/* Time Range Selector with Total */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Button
						variant={timeRange === '7days' ? 'default' : 'outline'}
						size="sm"
						onClick={() => setTimeRange('7days')}
					>
						Last 7 days
					</Button>
					<Button
						variant={timeRange === '30days' ? 'default' : 'outline'}
						size="sm"
						onClick={() => setTimeRange('30days')}
					>
						Last 30 days
					</Button>
					<Button
						variant={timeRange === '3months' ? 'default' : 'outline'}
						size="sm"
						onClick={() => setTimeRange('3months')}
					>
						Last 3 months
					</Button>
				</div>
				{/* Total Rows */}
				<div className="flex flex-col items-end gap-1">
					<span className="text-xs text-muted-foreground">Total Rows</span>
					<span className="text-2xl font-bold text-primary">{total.toLocaleString()}</span>
				</div>
			</div>

			{/* Bar Chart */}
			<ChartContainer config={chartConfig} className="h-[350px] w-full">
				<BarChart
					accessibilityLayer
					data={chartData}
					margin={{
						left: 12,
						right: 12,
					}}
				>
					<CartesianGrid vertical={false} />
					<XAxis
						dataKey="date"
						tickLine={false}
						axisLine={false}
						tickMargin={8}
						minTickGap={32}
						tickFormatter={(value) => {
							const date = new Date(value);
							return date.toLocaleDateString("en-US", {
								month: "short",
								day: "numeric",
							});
						}}
					/>
					<ChartTooltip
						content={
							<ChartTooltipContent
								className="w-[150px]"
								nameKey="rows"
								labelFormatter={(value) => {
									return new Date(value).toLocaleDateString("en-US", {
										month: "short",
										day: "numeric",
										year: "numeric",
									});
								}}
							/>
						}
					/>
					<Bar dataKey="rows" fill="var(--color-rows)" radius={4} />
				</BarChart>
			</ChartContainer>
		</div>
	);
}

const queriesChartConfig = {
	queries: {
		label: "Queries",
		color: "hsl(var(--primary))",
	},
} satisfies ChartConfig;

function QueriesPerDayChart() {
	const [timeRange, setTimeRange] = useState<'7days' | '30days' | '3months'>('30days');

	// Generate query data: ~200 weekdays, ~10 weekends
	const chartData = useMemo(() => {
		const data = [];
		const today = new Date();
		const days = timeRange === '7days' ? 7 : timeRange === '30days' ? 30 : 90;

		for (let i = days - 1; i >= 0; i--) {
			const date = new Date(today);
			date.setDate(date.getDate() - i);
			const dayOfWeek = date.getDay();
			const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

			// Weekend: ~60, Weekday: ~200
			const min = isWeekend ? 50 : 180;
			const max = isWeekend ? 80 : 220;
			const queries = Math.floor(Math.random() * (max - min + 1)) + min;

			data.push({
				date: date.toISOString().split('T')[0],
				queries,
			});
		}

		return data;
	}, [timeRange]);

	const total = useMemo(
		() => chartData.reduce((acc, curr) => acc + curr.queries, 0),
		[chartData]
	);

	return (
		<div className="space-y-4">
			{/* Time Range Selector with Total */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Button
						variant={timeRange === '7days' ? 'default' : 'outline'}
						size="sm"
						onClick={() => setTimeRange('7days')}
					>
						Last 7 days
					</Button>
					<Button
						variant={timeRange === '30days' ? 'default' : 'outline'}
						size="sm"
						onClick={() => setTimeRange('30days')}
					>
						Last 30 days
					</Button>
					<Button
						variant={timeRange === '3months' ? 'default' : 'outline'}
						size="sm"
						onClick={() => setTimeRange('3months')}
					>
						Last 3 months
					</Button>
				</div>
				<div className="flex flex-col items-end gap-1">
					<span className="text-xs text-muted-foreground">Total Queries</span>
					<span className="text-2xl font-bold text-primary">{total.toLocaleString()}</span>
				</div>
			</div>

			{/* Area Chart */}
			<ChartContainer config={queriesChartConfig} className="h-[250px] w-full">
				<AreaChart
					accessibilityLayer
					data={chartData}
					margin={{
						left: 12,
						right: 12,
						top: 10,
						bottom: 10,
					}}
				>
					<defs>
						<linearGradient id="fillQueries" x1="0" y1="0" x2="0" y2="1">
							<stop
								offset="5%"
								stopColor="var(--color-queries)"
								stopOpacity={0.8}
							/>
							<stop
								offset="95%"
								stopColor="var(--color-queries)"
								stopOpacity={0.1}
							/>
						</linearGradient>
					</defs>
					<CartesianGrid vertical={false} />
					<XAxis
						dataKey="date"
						tickLine={false}
						axisLine={false}
						tickMargin={8}
						minTickGap={32}
						tickFormatter={(value) => {
							const date = new Date(value);
							return date.toLocaleDateString("en-US", {
								month: "short",
								day: "numeric",
							});
						}}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						tickMargin={8}
						domain={[0, 'auto']}
					/>
					<ChartTooltip
						cursor={false}
						content={
							<ChartTooltipContent
								className="w-[150px]"
								nameKey="queries"
								labelFormatter={(value) => {
									return new Date(value).toLocaleDateString("en-US", {
										month: "short",
										day: "numeric",
										year: "numeric",
									});
								}}
								indicator="dot"
							/>
						}
					/>
					<Area
						dataKey="queries"
						type="natural"
						fill="url(#fillQueries)"
						stroke="var(--color-queries)"
						strokeWidth={2}
						baseValue={0}
					/>
				</AreaChart>
			</ChartContainer>
		</div>
	);
}

// Generate top users data
const topUsersData = [
	{ name: "Sarah Chen", queries: 1247 },
	{ name: "Michael Torres", queries: 1089 },
	{ name: "Emma Wilson", queries: 982 },
	{ name: "James Rodriguez", queries: 876 },
	{ name: "Olivia Martinez", queries: 754 },
	{ name: "Noah Anderson", queries: 698 },
	{ name: "Ava Thompson", queries: 612 },
	{ name: "Liam Garcia", queries: 587 },
	{ name: "Sophia Lee", queries: 521 },
	{ name: "William Kim", queries: 493 },
];

function TopUsersTable() {
	return (
		<div className="space-y-3">
			{topUsersData.map((user, index) => (
				<div
					key={user.name}
					className="flex items-center justify-between py-2 border-b last:border-0"
				>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold">
							{index + 1}
						</div>
						<span className="text-sm font-medium">{user.name}</span>
					</div>
					<span className="text-sm font-mono font-semibold text-primary">
						{user.queries.toLocaleString()}
					</span>
				</div>
			))}
		</div>
	);
}

function MetricsSkeleton() {
	return (
		<div className="grid gap-6">
			{/* 4 tiles skeleton */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{[1, 2, 3, 4].map((i) => (
					<Card key={i}>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-4 w-4 rounded" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-8 w-16 mb-2" />
							<Skeleton className="h-3 w-full" />
						</CardContent>
					</Card>
				))}
			</div>

			{/* Full width chart skeleton */}
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48 mb-2" />
					<Skeleton className="h-4 w-32" />
				</CardHeader>
				<CardContent className="pt-6">
					<Skeleton className="h-64 w-full" />
				</CardContent>
			</Card>
		</div>
	);
}
