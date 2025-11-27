import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function MetricsManagerPage() {
	return (
		<>
			<PageHeader title="Metrics Manager" />
			<div className="flex flex-1 flex-col">
				<ComingSoon />
			</div>
		</>
	);
}
