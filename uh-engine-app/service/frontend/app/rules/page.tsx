import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function RulesPage() {
	return (
		<>
			<PageHeader title="Rules" group="Timeseries" />
			<div className="flex flex-1 flex-col">
				<ComingSoon title="Timeseries is coming soon" />
			</div>
		</>
	);
}

