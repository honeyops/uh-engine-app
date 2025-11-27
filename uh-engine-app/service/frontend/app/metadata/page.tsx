import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function MetadataPage() {
	return (
		<>
			<PageHeader title="Metadata" />
			<div className="flex flex-1 flex-col">
				<ComingSoon />
			</div>
		</>
	);
}
