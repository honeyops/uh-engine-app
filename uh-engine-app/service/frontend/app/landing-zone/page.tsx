import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function LandingZonePage() {
	return (
		<>
			<PageHeader title="Landing Zone" group="Timeseries" />
			<div className="flex flex-1 flex-col">
				<ComingSoon title="Timeseries is coming soon" />
			</div>
		</>
	);
}

