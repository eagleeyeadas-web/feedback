import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Briefcase, ChevronLeft } from 'lucide-react';
import StaffWorkspaceLayout from '../../components/layout/StaffWorkspaceLayout';
import SalesWorkspace from '../admin/workspaces/SalesWorkspace';
import InstallationChecklistForm from '../admin/installation/InstallationChecklistForm';
import InstallationChecklistDetails from '../admin/installation/InstallationChecklistDetails';

export default function SalesWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [subView, setSubView] = useState(null);

  // Sync subview from URL params if present
  useEffect(() => {
    const createParam = searchParams.get('create');
    const viewParam = searchParams.get('view');
    const editParam = searchParams.get('edit');

    if (createParam === 'true') {
      setSubView({ type: 'create', id: null });
    } else if (editParam) {
      setSubView({ type: 'edit', id: editParam });
    } else if (viewParam) {
      setSubView({ type: 'view', id: viewParam });
    }
  }, [searchParams]);

  const handleBackToWorkspace = () => {
    setSubView(null);
    setSearchParams({});
  };

  const handleOpenCreate = () => {
    setSubView({ type: 'create', id: null });
    setSearchParams({ create: 'true' });
  };

  const handleOpenEdit = (id) => {
    setSubView({ type: 'edit', id });
    setSearchParams({ edit: id });
  };

  const handleOpenView = (id) => {
    setSubView({ type: 'view', id });
    setSearchParams({ view: id });
  };

  return (
    <StaffWorkspaceLayout
      title="Sales Workspace"
      departmentBadge="Sales Workspace"
      badgeColorClass="bg-blue-50 text-blue-700 border-blue-200"
      icon={Briefcase}
    >
      {/* 1. Subview: Create New Installation Checklist */}
      {subView?.type === 'create' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-200">
            <button
              type="button"
              onClick={handleBackToWorkspace}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-navy bg-white hover:bg-gray-50 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <ChevronLeft size={16} />
              <span>Back to Sales Workspace</span>
            </button>
            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
              New Installation Checklist
            </span>
          </div>

          <InstallationChecklistForm
            onSaved={(id) => handleOpenView(id)}
            onCancel={handleBackToWorkspace}
          />
        </div>
      )}

      {/* 2. Subview: Edit Permitted Installation Checklist */}
      {subView?.type === 'edit' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-200">
            <button
              type="button"
              onClick={handleBackToWorkspace}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-navy bg-white hover:bg-gray-50 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <ChevronLeft size={16} />
              <span>Back to Sales Workspace</span>
            </button>
            <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
              Edit Installation Checklist
            </span>
          </div>

          <InstallationChecklistForm
            id={subView.id}
            onSaved={(id) => handleOpenView(id)}
            onCancel={handleBackToWorkspace}
          />
        </div>
      )}

      {/* 3. Subview: View Checklist Details */}
      {subView?.type === 'view' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-200">
            <button
              type="button"
              onClick={handleBackToWorkspace}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-navy bg-white hover:bg-gray-50 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <ChevronLeft size={16} />
              <span>Back to Sales Workspace</span>
            </button>
            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
              Checklist Details
            </span>
          </div>

          <InstallationChecklistDetails
            id={subView.id}
            onEdit={(id) => handleOpenEdit(id)}
            onBack={handleBackToWorkspace}
          />
        </div>
      )}

      {/* 4. Default: Sales Workspace */}
      {!subView && (
        <SalesWorkspace
          onSelectChecklist={(id) => handleOpenView(id)}
          onCreateChecklist={handleOpenCreate}
        />
      )}
    </StaffWorkspaceLayout>
  );
}
