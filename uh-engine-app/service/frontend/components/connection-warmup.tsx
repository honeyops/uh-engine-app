'use client'

import { useEffect } from 'react'
import { warmupConnectionPool } from '@/lib/api/model-catalog'

/**
 * Silent component that warms up the Snowflake connection pool on app load.
 * This makes all subsequent database queries much faster.
 */
export function ConnectionWarmup() {
	useEffect(() => {
		// Fire and forget - warmup the connection pool in the background
		warmupConnectionPool()
			.then((result) => {
				console.log(`🔥 Connection pool warmed up in ${result.elapsed_ms}ms`)
			})
			.catch((error) => {
				console.warn('Failed to warmup connection pool:', error)
				// Don't show error to user - this is a background optimization
			})
	}, [])

	// This component renders nothing
	return null
}
