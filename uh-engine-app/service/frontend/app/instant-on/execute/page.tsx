import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function InstantOnExecutePage() {
	return (
		<>
			<PageHeader title="Instant On - Execution" group="Engine Management" />
			<div className="flex flex-1 flex-col">
				<ComingSoon />
			</div>
		</>
	);
}

