'use client'

import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { X, Loader2 } from 'lucide-react'
import { useModelCatalogWizard } from '@/lib/state/model-catalog-wizard'
import { useToast } from '@/hooks/use-toast'

export function DeploymentStatusIndicator() {
	const wizard = useModelCatalogWizard()
	const { toast } = useToast()

	// Only render when deploying
	if (!wizard.isDeploying) {
		return null
	}

	const handleClick = () => {
		// Reopen modal by setting minimized to false and ensuring it's open
		wizard.setIsMinimized(false)
		if (!wizard.isOpen) {
			wizard.open({ step: 'summary' })
		}
	}

	const handleCancel = (e: React.MouseEvent) => {
		e.stopPropagation() // Prevent opening modal when clicking cancel
		wizard.setIsDeploying(false)
		wizard.setIsMinimized(false) // Clear minimized state when canceling
		toast({
			title: "Deployment Cancelled",
			description: "The deployment has been cancelled. Some operations may still complete in the background.",
			variant: "destructive",
		})
	}

	const progress = Math.round(wizard.deploymentProgress)

	return (
		<Card
			className="fixed bottom-4 right-4 w-80 z-50 shadow-lg cursor-pointer hover:shadow-xl transition-shadow"
			onClick={handleClick}
		>
			<CardContent className="p-4">
				<div className="flex items-start justify-between gap-3">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2 mb-2">
							<Loader2 className="h-4 w-4 animate-spin text-primary" />
							<span className="text-sm font-semibold">Deploying Models</span>
						</div>
						<div className="space-y-2">
							<Progress value={progress} className="h-2" />
							<div className="flex items-center justify-between">
								<span className="text-xs text-muted-foreground">
									{progress}% complete
								</span>
								<span className="text-xs text-muted-foreground">
									Click to view details
								</span>
							</div>
						</div>
					</div>
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 shrink-0"
						onClick={handleCancel}
						title="Cancel deployment"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}

