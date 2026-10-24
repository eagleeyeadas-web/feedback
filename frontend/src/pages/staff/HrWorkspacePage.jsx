import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, ChevronLeft } from 'lucide-react';
import StaffWorkspaceLayout from '../../components/layout/StaffWorkspaceLayout';
import HrWorkspace from '../admin/workspaces/HrWorkspace';
import InstallationChecklistDetails from '../admin/installation/InstallationChecklistDetails';

export default function HrWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlViewId = searchParams.get('view');
  const [viewChecklistId, setViewChecklistId] = useState(urlViewId || null);

  useEffect(() => {
    if (urlViewId) {
      setViewChecklistId(urlViewId);
    } else {
      setViewChecklistId(null);
    }
  }, [urlViewId]);

  const handleBack = () => {
    setViewChecklistId(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('view');
      next.delete('action');
      return next;
    }, { replace: true });
  };

  return (
    <StaffWorkspaceLayout
      title="HR Workspace"
      departmentBadge="Technician Governance & Availability"
      badgeColorClass="bg-emerald-50 text-emerald-800 border-emerald-300"
      icon={Users}
    >
      {viewChecklistId ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-200">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-navy bg-white hover:bg-gray-50 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <ChevronLeft size={16} />
              <span>Back to HR Workspace</span>
            </button>
            <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-300">
              Checklist Details
            </span>
          </div>

          <InstallationChecklistDetails
            id={viewChecklistId}
            onBack={handleBack}
          />
        </div>
      ) : (
        <HrWorkspace />
      )}
    </StaffWorkspaceLayout>
  );
}
