import Link from 'next/link';
import { ArrowLeft, Mail, Phone, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';

/** Resolved, display-ready profile — names already looked up on the server. */
export type UserProfileData = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  designation: string | null;
  employeeId: string | null;
  employmentStatus: string | null;
  location: string | null;
  isActive: boolean;
  createdAt: string;
  /** Resolved names (null when unset or not resolvable). */
  departmentName: string | null;
  teamName: string | null;
  reportingManagerName: string | null;
};

function fullName(u: UserProfileData): string {
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  return u.displayName ?? u.name ?? u.email;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-surface-500 text-xs font-semibold uppercase tracking-wider">{label}</dt>
      <dd className="text-surface-900 text-sm">{value ?? <span className="text-surface-400">—</span>}</dd>
    </div>
  );
}

export function UserProfile({ profile }: { profile: UserProfileData }) {
  const name = fullName(profile);
  const initial = (profile.firstName?.[0] ?? profile.name?.[0] ?? profile.email[0] ?? '?').toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        breadcrumb={
          <Link href="/users" className="hover:text-surface-700 flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> People
          </Link>
        }
        title={name}
        subtitle={profile.designation ?? undefined}
        actions={
          <Badge variant={profile.isActive ? 'success' : 'default'}>
            {profile.isActive ? 'Active' : 'Inactive'}
          </Badge>
        }
      />

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="from-brand-400 to-brand-600 flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xl font-medium text-white shadow-sm">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                initial
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="text-surface-900 text-lg font-semibold">{name}</h2>
              <p className="text-surface-500 flex items-center gap-1.5 text-sm">
                <Mail className="h-3.5 w-3.5" /> {profile.email}
              </p>
              {profile.phone && (
                <p className="text-surface-500 flex items-center gap-1.5 text-sm">
                  <Phone className="h-3.5 w-3.5" /> {profile.phone}
                </p>
              )}
              {profile.location && (
                <p className="text-surface-500 flex items-center gap-1.5 text-sm">
                  <MapPin className="h-3.5 w-3.5" /> {profile.location}
                </p>
              )}
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <DetailRow label="Display name" value={profile.displayName} />
            <DetailRow label="Designation" value={profile.designation} />
            <DetailRow label="Department" value={profile.departmentName} />
            <DetailRow label="Team" value={profile.teamName} />
            <DetailRow label="Reporting manager" value={profile.reportingManagerName} />
            <DetailRow label="Employee ID" value={profile.employeeId} />
            <DetailRow label="Employment status" value={profile.employmentStatus} />
            <DetailRow label="Status" value={profile.isActive ? 'Active' : 'Inactive'} />
            <DetailRow
              label="Join date"
              value={new Date(profile.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
