import { useState } from 'react';
import { Warehouse, ChevronLeft } from 'lucide-react';
import StaffWorkspaceLayout from '../../components/layout/StaffWorkspaceLayout';
import StoreWorkspace from '../admin/workspaces/StoreWorkspace';
import InstallationChecklistDetails from '../admin/installation/InstallationChecklistDetails';

export default function StoreWorkspacePage() {
  const [viewChecklistId, setViewChecklistId] = useState(null);

  return (
    <StaffWorkspaceLayout
      title="Store Manager Workspace"
      departmentBadge="Store Manager Workspace"
      badgeColorClass="bg-amber-50 text-amber-800 border-amber-300"
      icon={Warehouse}
    >
      {viewChecklistId ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-200">
            <button
              type="button"
              onClick={() => setViewChecklistId(null)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-navy bg-white hover:bg-gray-50 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <ChevronLeft size={16} />
              <span>Back to Store Workspace</span>
            </button>
            <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-300">
              Checklist Details
            </span>
          </div>

          <InstallationChecklistDetails
            id={viewChecklistId}
            onBack={() => setViewChecklistId(null)}
          />
        </div>
      ) : (
        <StoreWorkspace onSelectChecklist={(id) => setViewChecklistId(id)} />
      )}
    </StaffWorkspaceLayout>
  );
}
