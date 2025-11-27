'use client'

import { useState } from 'react'
import { PageHeader } from "@/components/shared/PageHeader";
import { Database, Table, Layers, FileStack } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface LayerInfo {
	id: string;
	label: string;
	icon: React.ReactNode;
	description: string;
	details: string[];
}

const layers: LayerInfo[] = [
	{
		id: 'source',
		label: 'Source',
		icon: <Database className="h-4 w-4" />,
		description: 'The source layer represents the original data sources that feed into the modelling database.',
		details: [
			'Raw data from various source systems',
			'External data feeds and APIs',
			'Initial data ingestion point',
			'Data validation and quality checks'
		]
	},
	{
		id: 'staging',
		label: 'Staging',
		icon: <Table className="h-4 w-4" />,
		description: 'The staging layer provides a temporary holding area for data before it moves to storage tables.',
		details: [
			'Temporary data storage and transformation',
			'Data cleaning and normalization',
			'Schema validation and type conversion',
			'Preparation for permanent storage'
		]
	},
	{
		id: 'storage',
		label: 'Storage',
		icon: <Table className="h-4 w-4" />,
		description: 'Storage is the permanent storage layer where processed data is persisted.',
		details: [
			'Persistent data storage',
			'Optimized for query performance',
			'Historical data retention',
			'Foundation for dimensional models'
		]
	},
	{
		id: 'model',
		label: 'Model',
		icon: <Layers className="h-4 w-4" />,
		description: 'Models combine data from multiple storage tables to create dimensional structures.',
		details: [
			'Dimensional model construction',
			'Data integration from multiple sources',
			'Business logic and transformations',
			'Ready for semantic layer consumption'
		]
	},
	{
		id: 'semantic',
		label: 'Semantic Model',
		icon: <FileStack className="h-4 w-4" />,
		description: 'Semantic models provide business-friendly views of the data for end users and applications.',
		details: [
			'Business-friendly data views',
			'Pre-aggregated metrics and KPIs',
			'Optimized for reporting and analytics',
			'End-user consumption layer'
		]
	}
];

interface NodeProps {
	layer: LayerInfo;
	position: { x: number; y: number };
	onClick: () => void;
	isActive?: boolean;
}

function Node({ layer, position, onClick, isActive = false }: NodeProps) {
	const width = 84; // Reduced by 60% (40% of original 140)
	const height = 54; // Reduced by 60% (40% of original 90)
	
	return (
		<g onClick={onClick} className="cursor-pointer">
			<rect
				x={position.x}
				y={position.y}
				width={width}
				height={height}
				rx={8}
				fill={isActive ? "hsl(var(--primary) / 0.1)" : "white"}
				stroke={isActive ? "hsl(var(--primary))" : "hsl(var(--border))"}
				strokeWidth={isActive ? 3 : 2}
				className="drop-shadow-sm transition-all hover:stroke-primary hover:stroke-2"
			/>
			<foreignObject
				x={position.x}
				y={position.y}
				width={width}
				height={height}
				className="pointer-events-none"
			>
				<div className="flex flex-col items-center justify-center h-full gap-1 p-2">
					<div className={cn("text-primary", isActive && "scale-110 transition-transform")}>
						{layer.icon}
					</div>
					<span className="text-[10px] font-medium text-center leading-tight">
						{layer.label}
					</span>
				</div>
			</foreignObject>
		</g>
	);
}

interface ConnectionProps {
	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
}

function Connection({ fromX, fromY, toX, toY }: ConnectionProps) {
	const nodeWidth = 84; // Reduced by 60%
	const nodeHeight = 54; // Reduced by 60%
	
	const startX = fromX + nodeWidth;
	const startY = fromY + nodeHeight / 2;
	const endX = toX;
	const endY = toY + nodeHeight / 2;
	
	const controlX1 = startX + (endX - startX) * 0.5;
	const controlY1 = startY;
	const controlX2 = startX + (endX - startX) * 0.5;
	const controlY2 = endY;
	
	return (
		<path
			d={`M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`}
			fill="none"
			stroke="hsl(var(--border))"
			strokeWidth={2}
			markerEnd="url(#arrowhead)"
		/>
	);
}

export default function DatabasePage() {
	const [selectedLayer, setSelectedLayer] = useState<LayerInfo | null>(null);
	const centerY = 200;
	const nodeSpacing = 180; // Reduced spacing for smaller nodes
	
	const positions = layers.map((_, index) => ({
		x: 50 + index * nodeSpacing,
		y: centerY
	}));

	return (
		<>
			<PageHeader title="Database" group="Modelling" />
			{/* Page Title */}
			<div className="w-full px-6 pt-4 pb-2">
				<h1 className="text-3xl font-bold" style={{ color: 'hsl(var(--primary))' }}>Unified Honey Database</h1>
			</div>
			
			{/* Diagram at the top, full width - immediately under header */}
			<div className="w-full pb-4">
				<svg
					viewBox="0 0 1100 400"
					preserveAspectRatio="xMidYMid meet"
					className="w-full h-auto"
				>
							<defs>
								<marker
									id="arrowhead"
									markerWidth="10"
									markerHeight="10"
									refX="9"
									refY="3"
									orient="auto"
								>
									<polygon
										points="0 0, 10 3, 0 6"
										fill="hsl(var(--border))"
									/>
								</marker>
							</defs>
							
							{/* Connections */}
							{layers.slice(0, -1).map((_, index) => (
								<Connection
									key={`connection-${index}`}
									fromX={positions[index].x}
									fromY={positions[index].y}
									toX={positions[index + 1].x}
									toY={positions[index + 1].y}
								/>
							))}
							
							{/* Nodes */}
							{layers.map((layer, index) => (
								<Node
									key={layer.id}
									layer={layer}
									position={positions[index]}
									onClick={() => setSelectedLayer(layer)}
									isActive={selectedLayer?.id === layer.id}
								/>
							))}
				</svg>
			</div>
			
			{/* Description Section - directly under diagram */}
			<div className="flex flex-1 flex-col min-h-0">
				<div className="flex-1 overflow-auto">
					<div className="px-6 pt-0 pb-6">
						<Card>
							<CardHeader>
								<CardTitle>
									{selectedLayer ? `${selectedLayer.label} Layer` : 'Database Lineage'}
								</CardTitle>
								<CardDescription>
									{selectedLayer
										? selectedLayer.description
										: 'Click on any node in the diagram above to learn more about each layer.'}
								</CardDescription>
							</CardHeader>
							{selectedLayer && (
								<CardContent>
									<div className="space-y-2">
										<h4 className="text-sm font-semibold">Key Features:</h4>
										<ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground ml-2">
											{selectedLayer.details.map((detail, index) => (
												<li key={index}>{detail}</li>
											))}
										</ul>
									</div>
								</CardContent>
							)}
						</Card>
					</div>
				</div>
			</div>
		</>
	);
}
