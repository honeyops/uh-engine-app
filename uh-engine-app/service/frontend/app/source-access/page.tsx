import { PageHeader } from "@/components/shared/PageHeader"
import { SourceAccessSection } from "@/components/source-access/source-access-section"

export default function SourceAccessPage() {
	return (
		<>
			<PageHeader title="Source Access" group="Modelling" />
			<div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
				<div className="mx-auto w-full max-w-4xl">
					<SourceAccessSection />
				</div>
			</div>
		</>
	)
}



