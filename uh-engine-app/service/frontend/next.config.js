/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	output: 'standalone',
	generateBuildId: async () => 'uh-engine-build',
	experimental: {
		serverActions: {
			bodySizeLimit: '2mb',
		},
	},
	eslint: { ignoreDuringBuilds: true },
	typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
