const nextConfig = { poweredByHeader: false, devIndicators: false, agentRules: false, experimental: { authInterrupts: true }, watchOptions: { pollIntervalMs: 1000 }, outputFileTracingIncludes: { '/api/chat': ['./ficha-do-agente.md'], '/api/admin/avaliacao': ['./ficha-do-agente.md'] } };
export default nextConfig;
