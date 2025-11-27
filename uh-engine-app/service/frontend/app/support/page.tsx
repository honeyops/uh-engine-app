import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Globe, Heart, MessageSquare } from "lucide-react";
import Link from "next/link";

export default function SupportPage() {
	return (
		<>
			<PageHeader title="Support" />
			<div className="flex flex-1 flex-col min-h-0">
				<div className="flex-1 overflow-auto p-6">
					<div className="max-w-4xl mx-auto space-y-6">
						{/* Welcome Section */}
						<div className="space-y-4">
							<h1 className="text-3xl font-bold">We're Here to Help</h1>
							<p className="text-lg text-muted-foreground">
								At Unified Honey, we're dedicated to your success. Our team is committed to providing 
								exceptional support and ensuring you get the most out of our platform.
							</p>
						</div>

						{/* Support Cards */}
						<div className="grid gap-6 md:grid-cols-2">
							<Card>
								<CardHeader>
									<div className="flex items-center gap-2">
										<Mail className="h-5 w-5 text-primary" />
										<CardTitle>Email Support</CardTitle>
									</div>
									<CardDescription>
										Get in touch with our support team
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<p className="text-sm text-muted-foreground">
										Have a question or need assistance? We're just an email away.
									</p>
									<Button asChild variant="outline" className="w-full">
										<a href="mailto:support@unifiedhoney.com">
											<Mail className="mr-2 h-4 w-4" />
											support@unifiedhoney.com
										</a>
									</Button>
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<div className="flex items-center gap-2">
										<Globe className="h-5 w-5 text-primary" />
										<CardTitle>Visit Our Website</CardTitle>
									</div>
									<CardDescription>
										Learn more about Unified Honey
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<p className="text-sm text-muted-foreground">
										Explore our solutions, services, and resources.
									</p>
									<Button asChild variant="outline" className="w-full">
										<a href="https://unifiedhoney.com/" target="_blank" rel="noopener noreferrer">
											<Globe className="mr-2 h-4 w-4" />
											unifiedhoney.com
										</a>
									</Button>
								</CardContent>
							</Card>
						</div>

						{/* Feedback Section */}
						<Card className="border-primary/20 bg-primary/5">
							<CardHeader>
								<div className="flex items-center gap-2">
									<MessageSquare className="h-5 w-5 text-primary" />
									<CardTitle>Your Feedback Matters</CardTitle>
								</div>
								<CardDescription>
									Help us improve by sharing your thoughts
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<p className="text-sm text-muted-foreground">
									We value your input and are always looking for ways to enhance your experience. 
									Whether you have suggestions, feature requests, or want to share what's working well, 
									we'd love to hear from you.
								</p>
								<div className="flex items-center gap-2 text-sm">
									<Heart className="h-4 w-4 text-primary" />
									<span className="text-muted-foreground">
										Your feedback helps us build a better platform for everyone.
									</span>
								</div>
								<Button asChild variant="default" className="w-full">
									<a href="mailto:support@unifiedhoney.com?subject=Feedback">
										<MessageSquare className="mr-2 h-4 w-4" />
										Share Your Feedback
									</a>
								</Button>
							</CardContent>
						</Card>

						{/* Additional Help */}
						<Card>
							<CardHeader>
								<CardTitle>What We're Here For</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className="space-y-2 text-sm text-muted-foreground">
									<li className="flex items-start gap-2">
										<span className="text-primary mt-1">•</span>
										<span>Technical support and troubleshooting</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="text-primary mt-1">•</span>
										<span>Platform guidance and best practices</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="text-primary mt-1">•</span>
										<span>Feature questions and documentation</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="text-primary mt-1">•</span>
										<span>Feedback and suggestions for improvement</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="text-primary mt-1">•</span>
										<span>General inquiries about Unified Honey</span>
									</li>
								</ul>
							</CardContent>
						</Card>
					</div>
				</div>
			</div>
		</>
	);
}
