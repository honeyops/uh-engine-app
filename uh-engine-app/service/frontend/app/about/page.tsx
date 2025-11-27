import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function AboutPage() {
	return (
		<>
			<PageHeader title="About" />
			<div className="flex flex-1 flex-col">
				<ComingSoon />
			</div>
		</>
	);
}
