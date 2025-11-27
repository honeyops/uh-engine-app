import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function FeedbackPage() {
	return (
		<>
			<PageHeader title="Feedback" />
			<div className="flex flex-1 flex-col">
				<ComingSoon />
			</div>
		</>
	);
}

