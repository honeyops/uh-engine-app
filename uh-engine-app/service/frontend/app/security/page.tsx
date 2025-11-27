import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function SecurityPage() {
	return (
		<>
			<PageHeader title="Security" group="Modelling" />
			<div className="flex flex-1 flex-col">
				<ComingSoon />
			</div>
		</>
	);
}
