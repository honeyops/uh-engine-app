import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function FacilityPage() {
	return (
		<>
			<PageHeader title="Facility" group="Timeseries" />
			<div className="flex flex-1 flex-col">
				<ComingSoon title="Timeseries is coming soon" />
			</div>
		</>
	);
}

