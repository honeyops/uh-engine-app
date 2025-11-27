import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp, User, Zap } from "lucide-react";

export default function Page() {
	return (
		<>
			<PageHeader title="Home" />
			<div className="flex flex-1 flex-col p-6 lg:p-8">
				<div className="mx-auto w-full max-w-4xl space-y-8">
					{/* Hero Section */}
					<div className="space-y-4">
						<h1 className="text-4xl font-bold tracking-tight text-primary lg:text-5xl">
							The Unified Honey Engine
						</h1>
						<div className="space-y-4 text-lg text-muted-foreground">
							<p>
								Unified Honey Engine exists to help data teams deliver trustworthy insights faster. Instead of wrestling with infrastructure decisions, you get curated blueprints that standardize how data lands, is shaped, and becomes analytics-ready.
							</p>
							<p>
								Our mission is to compress the time between a business question and the clean dataset required to answer it. Every workflow prioritizes reusable patterns, built-in governance, and automation so your teams can spend their time on decisions, not plumbing.
							</p>
						</div>
					</div>

					{/* Instant On Architecture */}
					<div className="space-y-4">
						<h2 className="text-2xl font-semibold tracking-tight text-primary">Architecture</h2>
						<p className="text-muted-foreground">
							The Unified Honey Engine accepts source data from anywhere in your Snowflake account.
						</p>
						<p className="text-muted-foreground">
							The engine stages and prepares your data, then deposits it into the UNIFIED_HONEY database where it's automatically
							organized, modeled, and optionally surfaced in the semantic layer.
						</p>
						<p className="text-muted-foreground">
							From here, you can combine models or directly expose them in your own database for consumption.
						</p>

						<Card>
							<CardHeader>
								<CardTitle>Overview</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-2 py-4">
									{/* Sources */}
									<div className="flex flex-col items-center">
										<div className="flex gap-4 justify-center flex-wrap">
											<div className="rounded-lg border-2 border-border bg-muted/30 px-4 py-3 min-w-[120px] text-center">
												<p className="text-base font-medium">Source 1</p>
											</div>
											<div className="rounded-lg border-2 border-border bg-muted/30 px-4 py-3 min-w-[120px] text-center">
												<p className="text-base font-medium">Source 2</p>
											</div>
											<div className="rounded-lg border-2 border-border bg-muted/30 px-4 py-3 min-w-[120px] text-center">
												<p className="text-base font-medium">Source 3</p>
											</div>
										</div>
									</div>

									{/* Arrow Down */}
									<div className="flex justify-center">
										<ArrowDown className="h-6 w-6 text-primary" />
									</div>

									{/* Unified Honey Engine */}
									<div className="flex flex-col items-center">
										<div className="rounded-xl border-3 border-primary bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 px-8 py-6 min-w-[260px] text-center shadow-lg relative overflow-hidden">
											<div className="relative z-10">
												<div className="flex items-center justify-center gap-2 mb-2">
													<Zap className="h-6 w-6 text-primary" />
													<p className="text-base font-bold text-primary">Unified Honey Engine</p>
												</div>
												<p className="text-xs text-muted-foreground font-medium">Staging &amp; Processing</p>
											</div>
										</div>
									</div>

									{/* Arrow Down */}
									<div className="flex justify-center">
										<ArrowDown className="h-6 w-6 text-primary" />
									</div>

									{/* UNIFIED_HONEY Database Container */}
									<div className="flex flex-col items-center w-full">
										<div className="rounded-lg border-3 border-primary bg-primary/5 px-6 py-5 min-w-[280px] max-w-[400px] w-full">
											{/* Database Header */}
											<div className="text-center mb-4 pb-3 border-b border-primary/20">
												<p className="text-base font-bold text-primary">UNIFIED_HONEY Database</p>
											</div>

											{/* Layers inside database */}
											<div className="space-y-2">
												{/* Organised data store */}
												<div className="rounded-lg border-2 border-border bg-background px-4 py-3 text-center">
													<p className="text-base font-semibold">Organised data store</p>
												</div>

												{/* Arrow Down */}
												<div className="flex justify-center">
													<ArrowDown className="h-5 w-5 text-primary/50" />
												</div>

												{/* Modelled objects */}
												<div className="rounded-lg border-2 border-border bg-background px-4 py-3 text-center">
													<p className="text-base font-semibold">Modelled objects</p>
												</div>

												{/* Arrow Down */}
												<div className="flex justify-center">
													<ArrowDown className="h-5 w-5 text-primary/50" />
												</div>

												{/* Semantic views */}
												<div className="rounded-lg border-2 border-border bg-background px-4 py-3 text-center">
													<p className="text-base font-semibold">Semantic views</p>
													<p className="text-xs text-muted-foreground mt-1">(optional)</p>
												</div>
											</div>
										</div>
									</div>

									{/* Arrow Up to UNIFIED_HONEY Database (access) */}
									<div className="flex justify-center">
										<ArrowUp className="h-6 w-6 text-primary" />
									</div>

									{/* Your Data */}
									<div className="flex flex-col items-center">
										<div className="rounded-xl border-3 border-primary bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 px-8 py-6 min-w-[260px] text-center shadow-lg">
											<div className="flex items-center justify-center gap-2 mb-2">
												<User className="h-6 w-6 text-primary" />
												<p className="text-base font-bold text-primary">Your Data</p>
											</div>
											<p className="text-xs text-muted-foreground font-medium">Ready for Consumption</p>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>

					{/* Key Features Section */}
					<div className="space-y-6">
						<h2 className="text-2xl font-semibold tracking-tight text-primary">Key Features</h2>
						<ul className="space-y-3 text-muted-foreground">
							<li className="flex items-start gap-3">
								<span className="mt-1 text-primary">•</span>
								<span>Instant provisioning of curated landing zones, marts, and sandboxes</span>
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-1 text-primary">•</span>
								<span>Guardrails for governance, lineage, and access baked into every flow</span>
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-1 text-primary">•</span>
								<span>Blueprint-driven automation that keeps datasets consistent and auditable</span>
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-1 text-primary">•</span>
								<span>Self-service workspaces that keep business teams close to the data</span>
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-1 text-primary">•</span>
								<span>Integration touchpoints for your modeling, catalog, and observability stack</span>
							</li>
						</ul>
					</div>

					{/* Call to Action Section */}
					<div className="rounded-lg border bg-card p-6 shadow-sm">
						<h2 className="mb-3 text-2xl font-semibold tracking-tight text-primary">
							Ship analytics-ready data in days, not months
						</h2>
						<p className="text-muted-foreground">
							Pick a workflow in the sidebar to launch curated pipelines, enforce governance, and keep stakeholders supplied with clean, trusted data.
						</p>
					</div>
				</div>
			</div>
		</>
	);
}
