import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function EngineSecurityPage() {
	return (
		<>
			<PageHeader title="Security" group="Engine Management" />
			<div className="flex flex-1 flex-col">
				<ComingSoon />
			</div>
		</>
	);
}

