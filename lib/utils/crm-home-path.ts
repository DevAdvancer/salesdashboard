export function crmHomePath(user: { role: string; department?: string }, activeDashboard?: string) {
  if (user.role === 'compliance') return '/compliance-dashboard';
  const leadership = ['admin', 'developer', 'monitor', 'operations'].includes(user.role);
  return activeDashboard === 'resume' || (!leadership && user.department === 'resume') ? '/resume-dashboard' : '/dashboard';
}
