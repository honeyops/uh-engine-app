'use client';

import { Button } from '@/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { useQuery } from '@tanstack/react-query';
import { getSnowflakeAccountUrl } from '@/lib/api/snowflake';

const SnowflakeIcon = () => (
	<svg
		width="24"
		height="24"
		viewBox="0 0 16 16"
		fill="none"
		stroke="none"
		xmlns="http://www.w3.org/2000/svg"
		role="img"
		aria-label="Snowflake"
		className="h-4 w-4"
	>
		<g fillRule="evenodd" clipPath="url(#snowflake-prefix__a)" clipRule="evenodd">
			<path
				d="m8.58 8.118-.49.49a.167.167 0 0 1-.237 0l-.49-.49a.167.167 0 0 1 0-.236l.49-.49a.167.167 0 0 1 .237 0l.49.49a.167.167 0 0 1 0 .236m1.024-.616L8.47 6.367a.705.705 0 0 0-.997 0L6.34 7.502a.705.705 0 0 0 0 .996l1.134 1.135a.705.705 0 0 0 .997 0l1.134-1.135a.705.705 0 0 0 0-.996M6.086 0c-.558 0-1.011.453-1.011 1.012v2.094L3.247 2.051a1.011 1.011 0 0 0-1.011 1.752l3.208 1.852a1.012 1.012 0 0 0 1.653-.782v-3.86A1.01 1.01 0 0 0 6.088 0m-.797 8.384A1 1 0 0 0 5.367 8a1 1 0 0 0-.076-.384l-.019-.043-.027-.054-.013-.025-.006-.009-.035-.055-.02-.03-.038-.047-.027-.031q-.016-.02-.035-.037l-.036-.035q-.015-.014-.032-.026l-.047-.038-.03-.02-.055-.036-.009-.006-3.345-1.931A1.011 1.011 0 1 0 .506 6.945L2.333 8 .506 9.055a1.011 1.011 0 1 0 1.011 1.752l3.345-1.931.01-.006q.027-.016.054-.036l.03-.02.047-.038.032-.026.036-.035.035-.037.027-.031q.02-.023.038-.048l.02-.029.036-.055.005-.01.013-.024.027-.054zm.795 1.731c-.243 0-.467.086-.642.23l-3.208 1.852a1.011 1.011 0 0 0 1.011 1.752l1.828-1.055v2.095a1.011 1.011 0 0 0 2.023 0v-3.863c0-.558-.453-1.011-1.012-1.011m7.621 2.082-3.209-1.852a1.012 1.012 0 0 0-1.653.782v3.862a1.011 1.011 0 0 0 2.023 0v-2.095l1.827 1.055a1.011 1.011 0 1 0 1.012-1.752m1.73-3.142L13.609 8l1.828-1.055a1.012 1.012 0 1 0-1.012-1.752l-3.344 1.931-.01.006-.055.036-.029.02-.047.038-.032.026-.036.035-.036.037-.026.031q-.02.023-.038.048l-.02.029-.036.055-.006.01-.012.024a1 1 0 0 0-.08.195q-.008.02-.012.04a1 1 0 0 0 0 .492l.011.04a1 1 0 0 0 .08.195l.013.025.006.009q.017.028.036.055l.02.03.038.047.026.031.036.037.036.035q.015.014.032.026.022.02.047.038l.03.02q.027.02.055.036l.009.006 3.344 1.931a1.011 1.011 0 1 0 1.012-1.752m-1.36-6.634a1.01 1.01 0 0 0-1.382-.37l-1.827 1.055V1.012a1.011 1.011 0 1 0-2.023 0v3.862a1.011 1.011 0 0 0 1.653.781l3.209-1.852c.484-.28.65-.898.37-1.382"
				fill="currentColor"
			/>
		</g>
		<defs>
			<clipPath id="snowflake-prefix__a">
				<path fill="#fff" d="M0 0h16v16H0z"></path>
			</clipPath>
		</defs>
	</svg>
);

export function SnowflakeButton() {
	const { data, isLoading } = useQuery({
		queryKey: ['snowflake-account-url'],
		queryFn: getSnowflakeAccountUrl,
		staleTime: 1000 * 60 * 60, // Cache for 1 hour
	});

	const handleClick = () => {
		if (data?.account_url) {
			window.open(data.account_url, '_blank', 'noopener,noreferrer');
		}
	};

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-[rgb(42,181,232)] hover:bg-accent"
						onClick={handleClick}
						disabled={isLoading || !data?.account_url}
						aria-label="Open in Snowflake"
					>
						<SnowflakeIcon />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p>Open in Snowflake</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

