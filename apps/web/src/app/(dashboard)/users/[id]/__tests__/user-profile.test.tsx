import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserProfile, type UserProfileData } from '../user-profile';

const base: UserProfileData = {
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  name: 'Ada Lovelace',
  displayName: 'Ada',
  avatarUrl: null,
  phone: '+1 555 0100',
  designation: 'Principal Engineer',
  employeeId: 'E-42',
  employmentStatus: 'full_time',
  location: 'London',
  isActive: true,
  createdAt: '2024-01-15T00:00:00.000Z',
  departmentName: 'Engineering',
  teamName: 'Platform',
  reportingManagerName: 'Charles Babbage',
};

describe('UserProfile', () => {
  it('renders the resolved user details', () => {
    render(<UserProfile profile={base} />);
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Charles Babbage')).toBeInTheDocument();
    expect(screen.getByText('E-42')).toBeInTheDocument();
    // Status badge in header.
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    // Back link to the People list.
    expect(screen.getByRole('link', { name: /People/i })).toHaveAttribute('href', '/users');
  });

  it('shows an em dash for unset fields and inactive status', () => {
    render(
      <UserProfile
        profile={{
          ...base,
          isActive: false,
          departmentName: null,
          teamName: null,
          reportingManagerName: null,
        }}
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
  });
});
