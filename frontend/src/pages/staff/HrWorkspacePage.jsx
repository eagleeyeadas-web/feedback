import { Users } from 'lucide-react';
import StaffWorkspaceLayout from '../../components/layout/StaffWorkspaceLayout';
import HrWorkspace from '../admin/workspaces/HrWorkspace';

export default function HrWorkspacePage() {
  return (
    <StaffWorkspaceLayout
      title="HR Workspace"
      departmentBadge="Technician Governance & Availability"
      badgeColorClass="bg-emerald-50 text-emerald-800 border-emerald-300"
      icon={Users}
    >
      <HrWorkspace />
    </StaffWorkspaceLayout>
  );
}
