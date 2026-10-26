import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Briefcase, ChevronLeft, ClipboardList, FileText, History, Plus } from 'lucide-react';
import StaffWorkspaceLayout from '../../components/layout/StaffWorkspaceLayout';
import ErrorBoundary from '../../components/ErrorBoundary';
import SalesWorkspace from '../admin/workspaces/SalesWorkspace';
import InstallationChecklistForm from '../admin/installation/InstallationChecklistForm';
import InstallationChecklistDetails from '../admin/installation/InstallationChecklistDetails';
import QuotationGenerator from '../admin/QuotationGenerator';
import QuotationHistory from '../admin/QuotationHistory';

export default function SalesWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [subView, setSubView] = useState(null);

  // Read active tab from URL query params
  const tabParam = (searchParams.get('tab') || '').toLowerCase();
  const activeTab = tabParam === 'quotation-generator' || tabParam === 'generator'
    ? 'quotation-generator'
    : tabParam === 'quotation-history' || tabParam === 'history'
    ? 'quotation-history'
    : 'checklists';

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
    } else {
      setSubView(null);
    }
  }, [searchParams]);

  const handleSwitchTab = (newTab) => {
    setSubView(null);
    if (newTab === 'checklists') {
      setSearchParams({});
    } else {
      setSearchParams({ tab: newTab });
    }
  };

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
      <div className="space-y-5">
        {/* Workspace Navigation Tabs (Visible when not inside a detailed modal subview) */}
        {!subView && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2 rounded-2xl border border-gray-200 shadow-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleSwitchTab('checklists')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer ${
                  activeTab === 'checklists'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-gray-600 hover:text-navy hover:bg-gray-100'
                }`}
              >
                <ClipboardList size={15} />
                <span>Installation Checklists</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchTab('quotation-generator')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer ${
                  activeTab === 'quotation-generator'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-gray-600 hover:text-navy hover:bg-gray-100'
                }`}
              >
                <FileText size={15} />
                <span>Quotation Generator</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchTab('quotation-history')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer ${
                  activeTab === 'quotation-history'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-gray-600 hover:text-navy hover:bg-gray-100'
                }`}
              >
                <History size={15} />
                <span>Quotation History</span>
              </button>
            </div>

            {/* Quick Action Button on right of tab bar */}
            {activeTab === 'checklists' ? (
              <button
                type="button"
                onClick={handleOpenCreate}
                className="px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-xs ml-auto"
              >
                <Plus size={14} />
                <span>New Checklist</span>
              </button>
            ) : activeTab === 'quotation-history' ? (
              <button
                type="button"
                onClick={() => handleSwitchTab('quotation-generator')}
                className="px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-xs ml-auto"
              >
                <Plus size={14} />
                <span>Generate Quotation</span>
              </button>
            ) : null}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 1: Quotation Generator View                           */}
        {/* ======================================================== */}
        {activeTab === 'quotation-generator' && !subView && (
          <QuotationGenerator
            onNavigateToHistory={() => handleSwitchTab('quotation-history')}
            onBackToChecklists={() => handleSwitchTab('checklists')}
          />
        )}

        {/* ======================================================== */}
        {/* TAB 2: Quotation History View                            */}
        {/* ======================================================== */}
        {activeTab === 'quotation-history' && !subView && (
          <QuotationHistory
            onNavigateToGenerator={() => handleSwitchTab('quotation-generator')}
            onBackToChecklists={() => handleSwitchTab('checklists')}
          />
        )}

        {/* ======================================================== */}
        {/* TAB 3: Installation Checklists View & Subviews           */}
        {/* ======================================================== */}
        {activeTab === 'checklists' && (
          <>
            {/* Subview 1: Create New Installation Checklist */}
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

                <ErrorBoundary title="Checklist Creation Form Error" onReset={handleBackToWorkspace}>
                  <InstallationChecklistForm
                    onSaved={(id) => handleOpenView(id)}
                    onCancel={handleBackToWorkspace}
                  />
                </ErrorBoundary>
              </div>
            )}

            {/* Subview 2: Edit Existing Installation Checklist */}
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

                <ErrorBoundary title="Checklist Edit Form Error" onReset={handleBackToWorkspace}>
                  <InstallationChecklistForm
                    id={subView.id}
                    onSaved={(id) => handleOpenView(id)}
                    onCancel={handleBackToWorkspace}
                  />
                </ErrorBoundary>
              </div>
            )}

            {/* Subview 3: View Checklist Details */}
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

                <ErrorBoundary title="Checklist Details Error" onReset={handleBackToWorkspace}>
                  <InstallationChecklistDetails
                    id={subView.id}
                    onEdit={(id) => handleOpenEdit(id)}
                    onBack={handleBackToWorkspace}
                  />
                </ErrorBoundary>
              </div>
            )}

            {/* Default: Sales Workspace Checklist Dashboard */}
            {!subView && (
              <SalesWorkspace
                onSelectChecklist={(id) => handleOpenView(id)}
                onCreateChecklist={handleOpenCreate}
                onNavigateTab={handleSwitchTab}
              />
            )}
          </>
        )}
      </div>
    </StaffWorkspaceLayout>
  );
}
