'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Plus, RefreshCw } from 'lucide-react'

import { listDatabases } from '@/lib/api/model-catalog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const DEFAULT_DESCRIPTION =
	'The Unified Honey Engine needs read access to the source databases that you want it to process. Grant SELECT permissions on each database to the application role so the engine can read and stage your data.'

export type SourceAccessSectionProps = {
	/**
	 * Allow parent flows (e.g., Instant On wizard) to defer fetching until the user reaches this step.
	 */
	isEnabled?: boolean
	title?: string
	description?: string
}

export function SourceAccessSection({
	isEnabled = true,
	title = 'Access',
	description = DEFAULT_DESCRIPTION,
}: SourceAccessSectionProps) {
	const [newDatabaseName, setNewDatabaseName] = useState('')
	const [generatedSQL, setGeneratedSQL] = useState('')
	const { toast } = useToast()

	const {
		data: accessibleDatabases = [],
		isLoading,
		error,
		refetch,
	} = useQuery<string[]>({
		queryKey: ['source-databases'],
		queryFn: listDatabases,
		staleTime: 0,
		enabled: isEnabled,
	})

	const accessibleDatabasesError = useMemo(() => {
		if (!error) return null
		return error instanceof Error ? error.message : 'Please try again.'
	}, [error])

	const handleGenerateSql = () => {
		const trimmedName = newDatabaseName.trim().toUpperCase()
		if (!trimmedName) {
			return
		}

		const sql = `-- Grant USAGE on the database
GRANT USAGE ON DATABASE ${trimmedName} TO APPLICATION ROLE app_user;

-- Grant USAGE and SELECT on all existing schemas
GRANT USAGE ON ALL SCHEMAS IN DATABASE ${trimmedName} TO APPLICATION ROLE app_user;
GRANT SELECT ON ALL TABLES IN ALL SCHEMAS IN DATABASE ${trimmedName} TO APPLICATION ROLE app_user;

-- Grant USAGE and SELECT on future schemas and tables
GRANT USAGE ON FUTURE SCHEMAS IN DATABASE ${trimmedName} TO APPLICATION ROLE app_user;
GRANT SELECT ON FUTURE TABLES IN DATABASE ${trimmedName} TO APPLICATION ROLE app_user;`

		setGeneratedSQL(sql)
	}

	const handleCopySql = () => {
		if (!generatedSQL) {
			return
		}

		navigator.clipboard.writeText(generatedSQL)
		toast({
			title: 'SQL copied to clipboard',
			description: 'You can now paste it into Snowflake',
		})
	}

	return (
		<section className="space-y-6">
			<div className="space-y-2">
				<h2 className="text-2xl font-semibold">{title}</h2>
				<p className="text-muted-foreground">{description}</p>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Accessible Databases</CardTitle>
							<CardDescription>Databases that the application role can currently read</CardDescription>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => refetch()}
							disabled={isLoading}
							className="flex items-center gap-2"
						>
							<RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
							Refresh
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-2">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					) : accessibleDatabasesError ? (
						<div className="rounded-md border border-amber-500/50 bg-amber-50/70 px-3 py-2 text-sm text-amber-900">
							Unable to load databases. {accessibleDatabasesError}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Database Name</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{accessibleDatabases.length === 0 ? (
									<TableRow>
										<TableCell colSpan={1} className="py-8 text-center text-muted-foreground">
											No accessible databases found. Add a database below to grant access.
										</TableCell>
									</TableRow>
								) : (
									accessibleDatabases.map((db) => (
										<TableRow key={db}>
											<TableCell className="font-medium">{db}</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Grant Access to Database</CardTitle>
					<CardDescription>Enter a database name to generate the SQL grant statement</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex gap-2">
						<Input
							placeholder="Enter database name (e.g., MY_DATABASE)"
							value={newDatabaseName}
							onChange={(event) => {
								setNewDatabaseName(event.target.value.toUpperCase())
								setGeneratedSQL('')
							}}
							className="flex-1"
						/>
						<Button
							onClick={handleGenerateSql}
							disabled={!newDatabaseName.trim()}
							className="flex items-center gap-2"
						>
							<Plus className="h-4 w-4" />
							Generate SQL
						</Button>
					</div>

					{generatedSQL && (
						<div className="space-y-3">
							<div className="rounded-lg border bg-muted/50 p-4">
								<div className="mb-2 flex items-center justify-between">
									<p className="text-sm font-medium">Generated SQL</p>
									<Button variant="ghost" size="sm" onClick={handleCopySql} className="h-8 w-8 p-0">
										<Copy className="h-4 w-4" />
									</Button>
								</div>
								<pre className="rounded border bg-background p-3 text-xs">
									<code>{generatedSQL}</code>
								</pre>
							</div>

							<div className="rounded-lg border border-amber-500/20 bg-amber-50/50 p-4">
								<p className="mb-2 text-sm font-medium text-amber-900">Instructions:</p>
								<ol className="list-inside list-decimal space-y-1 text-sm text-amber-800">
									<li>Copy the SQL statement above</li>
									<li>Connect to Snowflake with ACCOUNTADMIN or a role that can grant privileges</li>
									<li>Run the SQL statement in a Snowflake worksheet</li>
									<li>Click the &quot;Refresh&quot; button above to reload the accessible databases list</li>
								</ol>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</section>
	)
}

