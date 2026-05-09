export type AuditLogPathSlice = { auditLogPath: string | null }

export function createAuditLogPathSlice(): AuditLogPathSlice {
	return { auditLogPath: null }
}
