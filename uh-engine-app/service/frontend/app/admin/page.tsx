import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function AdminPage() {
	return (
		<>
			<PageHeader title="Admin" />
			<div className="flex flex-1 flex-col">
				<ComingSoon />
			</div>
		</>
	);
}
