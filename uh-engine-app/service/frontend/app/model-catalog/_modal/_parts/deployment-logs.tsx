'use client'

import { useEffect, useRef, useMemo, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusBadge, type StatusBadgeTone } from '@/components/badges/status-badge'
import { useModelCatalogWizard, type DeploymentLog } from '@/lib/state/model-catalog-wizard'
import { Terminal, Download, AlertCircle, ChevronUp, ChevronRight } from 'lucide-react'

type LogLevel = 'ERROR' | 'WARNING' | 'SUCCESS' | 'INFO'

const levelToneMap: Record<LogLevel, StatusBadgeTone> = {
	ERROR: 'danger',
	WARNING: 'warning',
	SUCCESS: 'success',
	INFO: 'info',
}

// Format timestamp for display (HH:MM:SS)
function formatTime(timestamp: string): string {
	try {
		const date = new Date(timestamp)
		return date.toLocaleTimeString('en-US', { hour12: false })
	} catch {
		return ''
	}
}

// Export logs to CSV
function exportLogsToCSV(logs: DeploymentLog[]) {
	const headers = ['Timestamp', 'Level', 'Step', 'Object', 'Message']
	const rows = logs.map(log => [
		log.timestamp,
		log.level,
		log.step,
		log.object_name,
		// Escape quotes in message for CSV
		`"${log.message.replace(/"/g, '""')}"`,
	])

	const csvContent = [
		headers.join(','),
		...rows.map(row => row.join(','))
	].join('\n')

	// Create blob and download
	const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
	const link = document.createElement('a')
	const url = URL.createObjectURL(blob)
	link.setAttribute('href', url)
	link.setAttribute('download', `deployment-logs-${new Date().toISOString().split('T')[0]}.csv`)
	link.style.visibility = 'hidden'
	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
}

type DeploymentLogsProps = {
	isLogPanelOpen: boolean
	onToggle: () => void
}

export default function DeploymentLogs({ isLogPanelOpen, onToggle }: DeploymentLogsProps) {
	const wizard = useModelCatalogWizard()
	const logEndRef = useRef<HTMLDivElement>(null)
	const errorRefs = useRef<Map<number, HTMLDivElement>>(new Map())

	// Extract error logs and create unique error messages
	const errorSummary = useMemo(() => {
		const errorLogs = wizard.logLines
			.map((log, index) => ({ ...log, index }))
			.filter(log => log.level?.toUpperCase() === 'ERROR')

		if (errorLogs.length === 0) return null

		// Get unique error messages
		const uniqueErrors = Array.from(
			new Map(errorLogs.map(log => [log.message, log])).values()
		)

		return {
			total: errorLogs.length,
			unique: uniqueErrors,
			firstErrorIndex: errorLogs[0]?.index ?? 0
		}
	}, [wizard.logLines])

	// Auto-scroll to bottom when new logs are added
	useEffect(() => {
		if (logEndRef.current) {
			// Use requestAnimationFrame to ensure the DOM has updated before scrolling
			requestAnimationFrame(() => {
				logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
			})
		}
	}, [wizard.logLines])

	// Scroll to first error
	const scrollToFirstError = () => {
		if (errorSummary) {
			const firstErrorElement = errorRefs.current.get(errorSummary.firstErrorIndex)
			if (firstErrorElement) {
				firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
			}
		}
	}

	// Determine status based on logs and deploying state
	let statusBadge = null
	if (wizard.isDeploying) {
		statusBadge = <StatusBadge label="Deploying..." tone="orange" indicator="none" />
	} else if (wizard.logLines.length > 0) {
		const hasErrors = wizard.logLines.some(log => log.level?.toUpperCase() === 'ERROR')
		const lastLog = wizard.logLines[wizard.logLines.length - 1]
		const hasCompletionMessage = lastLog?.message?.toLowerCase().includes('complete') || 
			lastLog?.message?.toLowerCase().includes('successfully') ||
			lastLog?.message?.toLowerCase().includes('deployment successful') ||
			lastLog?.message?.toLowerCase().includes('deployment complete')

		// If deployment finished (isDeploying is false) and we have logs, show Complete
		if (!wizard.isDeploying && (hasCompletionMessage || lastLog)) {
			if (hasErrors) {
				statusBadge = <StatusBadge label="Failed" tone="red" indicator="none" />
			} else {
				statusBadge = <StatusBadge label="Complete" tone="green" indicator="none" />
			}
		} else if (hasErrors) {
			statusBadge = <StatusBadge label="Failed" tone="red" indicator="none" />
		} else {
			statusBadge = <StatusBadge label="Ready" tone="grey" indicator="none" />
		}
	} else {
		statusBadge = <StatusBadge label="Ready" tone="grey" indicator="none" />
	}

	return (
		<div className="flex flex-col border rounded-md overflow-hidden h-full flex-1 min-h-0">
			<div className="flex items-center justify-between px-4 py-3 border-b bg-muted/40 shrink-0">
				<div className="flex items-center gap-2">
					<Terminal className="h-4 w-4" />
					<div className="text-sm font-medium">Deployment Logs</div>
				</div>
				<div className="flex items-center gap-2">
					{statusBadge}
					{wizard.logLines.length > 0 && !wizard.isDeploying && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => exportLogsToCSV(wizard.logLines)}
							className="h-8"
						>
							<Download className="h-3.5 w-3.5 mr-1.5" />
							Export CSV
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						onClick={onToggle}
						className="h-8 w-8 p-0"
						title="Hide logs"
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			</div>
			<ScrollArea className="flex-1 min-h-0 p-4 bg-white text-slate-900">
				{wizard.logLines.length === 0 ? (
					<div className="text-sm py-8 text-slate-500">
						Waiting for deployment to start...
					</div>
				) : (
					<div className="space-y-0.5">
						{wizard.logLines.map((log, index) => {
							const isError = log.level?.toUpperCase() === 'ERROR'
							const level = (log.level?.toUpperCase() || 'INFO') as 'ERROR' | 'WARNING' | 'SUCCESS' | 'INFO'
							const levelToneMap: Record<typeof level, StatusBadgeTone> = {
								ERROR: 'danger',
								WARNING: 'warning',
								SUCCESS: 'success',
								INFO: 'info',
							}
							const formattedLevel = level.charAt(0) + level.slice(1).toLowerCase()

							// Parse message to make object names bold
							// Object names are typically: ALL_CAPS words, or words with dots/underscores
							const renderMessage = () => {
								const message = log.message || ''
								const parts = message.split(/(\b[A-Z][A-Z0-9_]*\b|\b\w+\.\w+(?:\.\w+)*\b|\b\w+_\w+(?:_\w+)*\b)/g)
								return parts.map((part, i) => {
									// Check if this part matches an object name pattern
									if (part && (/^[A-Z][A-Z0-9_]+$/.test(part) || /^\w+\.\w+/.test(part) || /^\w+_\w+_/.test(part))) {
										return <strong key={i}>{part}</strong>
									}
									return part
								})
							}

							return (
								<div
									key={index}
									ref={(el) => {
										if (el && isError) {
											errorRefs.current.set(index, el)
										} else if (!isError) {
											errorRefs.current.delete(index)
										}
									}}
									className="text-sm flex items-start gap-3 py-1 text-slate-900"
								>
									<StatusBadge
										label={formattedLevel}
										tone={levelToneMap[level]}
										indicator="none"
										className="shrink-0 uppercase tracking-tight"
									/>
									<span className="flex-1">{renderMessage()}</span>
								</div>
							)
						})}
						<div ref={logEndRef} />
					</div>
				)}
			</ScrollArea>
		</div>
	)
}
