// Docker container monitoring for office visualization
// Simulated version - replace with actual Docker SDK integration

let dockerSocket = null

export async function initDockerMonitor() {
  // In production, connect to Docker socket
  // For now, return simulated data
  return {
    getContainers: async () => {
      // Simulate Docker API call
      const containers = [
        { id: 'abc123', name: 'freeilmapi', image: 'tashfeenahmed/freeilmapi', status: 'running', health: 'healthy' },
        { id: 'def456', name: 'nginx', image: 'nginx:latest', status: 'running', health: 'healthy' },
        { id: 'ghi789', name: 'postgres', image: 'postgres:15', status: 'running', health: 'healthy' },
        { id: 'jkl012', name: 'redis', image: 'redis:7', status: 'exited', health: 'unhealthy' },
      ]
      return containers
    },
    getStats: async (containerId) => {
      return {
        cpu: Math.random() * 100,
        memory: Math.floor(Math.random() * 512 * 1024 * 1024),
        network: { rx: 0, tx: 0 }
      }
    }
  }
}

export function shouldAutoBreak(cpuUsage, isManual) {
  if (isManual) return true
  return cpuUsage < 5
}
