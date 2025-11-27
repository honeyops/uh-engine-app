'use client'

import { useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useModelCatalogWizard, type DeploymentLog } from '@/lib/state/model-catalog-wizard'
import { CheckCircle2, Info, XCircle } from 'lucide-react'

function getLogIcon(level: string) {
	switch (level.toUpperCase()) {
		case 'SUCCESS':
			return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
		case 'ERROR':
			return <XCircle className="h-4 w-4 text-red-500 shrink-0" />
		case 'INFO':
		case 'WARNING':
		default:
			return <Info className="h-4 w-4 text-blue-500 shrink-0" />
	}
}

export default function DeploymentOutput() {
	const wizard = useModelCatalogWizard()
	const logEndRef = useRef<HTMLDivElement>(null)

	// Filter out INFO logs that are about creating/deploying (duplicative)
	const filteredLogs = wizard.logLines.filter((log) => {
		if (log.level?.toUpperCase() === 'INFO') {
			const msg = log.message.toLowerCase()
			// Filter out INFO messages about creating, deploying, starting, etc.
			if (
				msg.includes('creating') ||
				msg.includes('deploying') ||
				msg.includes('starting') ||
				msg.includes('initialized') ||
				msg.includes('initializing')
			) {
				return false
			}
		}
		return true
	})

	// Auto-scroll to bottom when new logs are added
	useEffect(() => {
		if (logEndRef.current) {
			logEndRef.current.scrollIntoView({ behavior: 'smooth' })
		}
	}, [wizard.logLines])

	return (
		<Card className="flex flex-col flex-1 min-h-0">
			<CardContent className="flex-1 overflow-hidden p-0">
				<ScrollArea className="h-full p-4">
					{filteredLogs.length === 0 ? (
						<div className="text-sm text-muted-foreground py-8 text-center">
							{wizard.logLines.length > 0 ? 'Processing...' : 'Click Deploy to begin deployment'}
						</div>
					) : (
						<div className="space-y-2">
							{filteredLogs.map((log, index) => (
								<div
									key={index}
									className="flex items-start gap-3 py-1.5"
								>
									{getLogIcon(log.level)}
									<span className="text-sm flex-1">
										{log.message}
									</span>
								</div>
							))}
							<div ref={logEndRef} />
						</div>
					)}
				</ScrollArea>
			</CardContent>
		</Card>
	)
}
