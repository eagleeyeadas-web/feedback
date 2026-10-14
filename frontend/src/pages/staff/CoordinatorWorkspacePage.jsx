import { CalendarCheck } from 'lucide-react';
import StaffWorkspaceLayout from '../../components/layout/StaffWorkspaceLayout';
import CoordinatorWorkspace from '../admin/workspaces/CoordinatorWorkspace';

export default function CoordinatorWorkspacePage() {
  return (
    <StaffWorkspaceLayout
      title="Coordinator Workspace"
      departmentBadge="Travel & Room Logistics"
      badgeColorClass="bg-indigo-50 text-indigo-800 border-indigo-300"
      icon={CalendarCheck}
    >
      <CoordinatorWorkspace />
    </StaffWorkspaceLayout>
  );
}
