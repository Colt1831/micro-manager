import { notFound } from 'next/navigation';
import { serverFetchJson } from '@/lib/api/server-fetch';
import { UserProfile, type UserProfileData } from './user-profile';
import type { UserRecord } from '../users-client';

// Per-request, auth-scoped data — never statically cached.
export const dynamic = 'force-dynamic';

type ApiUser = UserRecord & {
  phone: string | null;
  employeeId: string | null;
  location: string | null;
};

// Next.js 16: dynamic route params are async.
export default async function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The GET route enforces org scope + permissions; null means 404/403/failure.
  const data = await serverFetchJson<{ user: ApiUser }>(`/api/users/${id}`);
  if (!data?.user) notFound();
  const u = data.user;

  // Resolve id references to names via the same auth-scoped list endpoints.
  // Best-effort: a failed lookup just renders "—" rather than blocking the page.
  const [usersData, deptData, teamData] = await Promise.all([
    u.reportingManagerId ? serverFetchJson<{ users: UserRecord[] }>('/api/users') : null,
    u.departmentId
      ? serverFetchJson<{ departments: { id: string; name: string }[] }>('/api/departments')
      : null,
    u.teamId ? serverFetchJson<{ teams: { id: string; name: string }[] }>('/api/teams') : null,
  ]);

  const manager = usersData?.users.find((m) => m.id === u.reportingManagerId) ?? null;
  const managerName = manager
    ? manager.firstName && manager.lastName
      ? `${manager.firstName} ${manager.lastName}`
      : (manager.displayName ?? manager.name ?? manager.email)
    : null;

  const profile: UserProfileData = {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    name: u.name,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    phone: u.phone,
    designation: u.designation,
    employeeId: u.employeeId,
    employmentStatus: u.employmentStatus,
    location: u.location,
    isActive: u.isActive,
    createdAt: u.createdAt,
    departmentName: deptData?.departments.find((d) => d.id === u.departmentId)?.name ?? null,
    teamName: teamData?.teams.find((t) => t.id === u.teamId)?.name ?? null,
    reportingManagerName: managerName,
  };

  return <UserProfile profile={profile} />;
}
