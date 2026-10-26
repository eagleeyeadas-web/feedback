import { useState, useEffect, useRef } from 'react';
import {
  X,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Package,
  Layers,
  Plus,
  Trash2,
  Search,
  Info,
  ShieldCheck,
  Truck,
  User,
  MapPin,
  Calendar,
  Smartphone,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import {
  submitInstallationCompletionReport,
  fetchInstallationCompletionReport,
  fetchBackupProducts,
  fetchBackupDeclaration,
  fetchDeviceConfigurations,
  fetchAdditionalCustomerInstallations,
} from '../../lib/api';
import { isScrewMaterial } from '../../lib/productHelpers';
export { isScrewMaterial };

export const DEFAULT_CONFIGS = [
  {
    device_type: '2 Channel Live',
    components: [
      { component_name: 'Camera', quantity_required: 2, unit: 'Nos.' },
      { component_name: 'Live Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '2 Channel Recording',
    components: [
      { component_name: 'Camera', quantity_required: 2, unit: 'Nos.' },
      { component_name: 'Recording Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '4 Channel Live',
    components: [
      { component_name: 'Camera', quantity_required: 4, unit: 'Nos.' },
      { component_name: 'Live Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '4 Channel Recording',
    components: [
      { component_name: 'Camera', quantity_required: 4, unit: 'Nos.' },
      { component_name: 'Recording Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '6 Channel Live',
    components: [
      { component_name: 'Camera', quantity_required: 6, unit: 'Nos.' },
      { component_name: 'Live Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '6 Channel Recording',
    components: [
      { component_name: 'Camera', quantity_required: 6, unit: 'Nos.' },
      { component_name: 'Recording Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '8 Channel Live',
    components: [
      { component_name: 'Camera', quantity_required: 8, unit: 'Nos.' },
      { component_name: 'Live Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
];

export function getComponentBreakdownForConfig(configName, configsList = DEFAULT_CONFIGS) {
  if (!configName) return [];
  const found = (configsList || DEFAULT_CONFIGS).find(
    (c) => c.device_type.toLowerCase() === configName.toLowerCase()
  );
  if (found && Array.isArray(found.components)) {
    return found.components.map((c) => ({
      component_name: c.component_name,
      quantity: c.quantity_required,
      unit: c.unit || 'Nos.',
    }));
  }
  const match = configName.match(/^(\d+)\s*channel\s*(live|recording)/i);
  if (match) {
    const channels = parseInt(match[1], 10);
    const isLive = match[2].toLowerCase() === 'live';
    return [
      { component_name: 'Camera', quantity: channels, unit: 'Nos.' },
      { component_name: isLive ? 'Live Display' : 'Recording Display', quantity: 1, unit: 'Nos.' },
    ];
  }
  return [
    { component_name: 'Camera', quantity: 2, unit: 'Nos.' },
    { component_name: 'Live Display', quantity: 1, unit: 'Nos.' },
  ];
}

/**
 * Searchable Dropdown filtered by Category from existing database catalogue
 */
function SearchableProductSelect({
  value,
  products = [],
  onSelect,
  placeholder = 'Search & select product...',
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const selectedProduct = products.find(
    (p) =>
      (p.item_name || '').toLowerCase() === (value || '').toLowerCase() ||
      p.id === value ||
      (p.display_name || '').toLowerCase() === (value || '').toLowerCase()
  );

  const filtered = products.filter((p) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (p.item_name && p.item_name.toLowerCase().includes(term)) ||
      (p.sku && p.sku.toLowerCase().includes(term)) ||
      (p.display_name && p.display_name.toLowerCase().includes(term))
    );
  });

  if (disabled) {
    return (
      <div className="w-full text-left text-xs p-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-800 font-semibold truncate">
        {selectedProduct ? selectedProduct.item_name : value || placeholder}
      </div>
    );
  }

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setSearchTerm('');
        }}
        className={`w-full text-left text-xs p-2 rounded-lg border flex items-center justify-between transition-all cursor-pointer bg-white ${
          isOpen
            ? 'border-purple-500 ring-2 ring-purple-100 shadow-sm'
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {selectedProduct ? (
            <>
              <span className="font-semibold text-gray-900 truncate">{selectedProduct.item_name}</span>
              {selectedProduct.sku && selectedProduct.sku !== 'N/A' && (
                <span className="text-[10px] text-gray-400 font-mono shrink-0">({selectedProduct.sku})</span>
              )}
            </>
          ) : value ? (
            <span className="font-semibold text-gray-900 truncate">{value}</span>
          ) : (
            <span className="text-gray-400 font-medium truncate">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${
            isOpen ? 'rotate-180 text-purple-600' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden max-h-60 flex flex-col text-xs animate-in fade-in zoom-in-95 duration-100 min-w-[240px]">
          {/* Search Input */}
          <div className="p-2 border-b border-gray-100 bg-slate-50 flex items-center gap-1.5 sticky top-0 z-10">
            <Search className="w-3.5 h-3.5 text-gray-400 ml-1 shrink-0" />
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Type to filter products..."
              className="w-full text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-purple-500 font-medium text-gray-900"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="p-1 text-gray-400 hover:text-gray-600 rounded cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Options List */}
          <div className="overflow-y-auto flex-1 divide-y divide-gray-50 p-1">
            {filtered.length === 0 ? (
              <div className="py-5 text-center text-gray-400 text-xs italic">
                No matching catalogue products found
              </div>
            ) : (
              filtered.map((p) => {
                const isSelected =
                  selectedProduct?.id === p.id ||
                  (selectedProduct?.item_name || '').toLowerCase() === (p.item_name || '').toLowerCase();
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onSelect(p);
                      setIsOpen(false);
                      setSearchTerm('');
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-purple-50 text-purple-900 font-bold'
                        : 'hover:bg-slate-50 text-gray-800'
                    }`}
                  >
                    <div className="truncate pr-2">
                      <div className="font-semibold text-xs flex items-center gap-1.5 truncate">
                        <span>{p.item_name}</span>
                        {p.sku && p.sku !== 'N/A' && (
                          <span className="text-[10px] text-gray-400 font-mono font-normal">({p.sku})</span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 block font-normal">
                        Category: <strong className="text-gray-600 font-medium">{p.category}</strong>
                      </span>
                    </div>
                    <span className="shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 bg-gray-100 text-gray-700 rounded border border-gray-200">
                      {p.unit || 'Nos.'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Checks if a product name belongs to the device component category
 */
function isDeviceComponent(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower.includes('camera') ||
    lower.includes('display') ||
    lower.includes('screen') ||
    lower.includes('cable') ||
    lower.includes('memory') ||
    lower.includes('sd card') ||
    lower.includes('mdvr') ||
    lower.includes('sensor') ||
    lower.includes('system')
  );
}

export default function InstallationCompletionModal({
  checklist,
  token,
  readOnly = false,
  onClose,
  onSuccess,
}) {
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(true);
  const [error, setError] = useState('');
  const [completionStatus, setCompletionStatus] = useState('Completed');
  const [generalRemarks, setGeneralRemarks] = useState('');
  const [availableProducts, setAvailableProducts] = useState([]);

  // Three distinct collections:
  // 1. Required customer installation devices
  const [requiredDeviceItems, setRequiredDeviceItems] = useState([]);
  // 2. Extra backup items carried (return tracking only)
  const [backupItems, setBackupItems] = useState([]);
  // 3. Standard fitting materials from preliminary BOM (screws excluded)
  const [standardMaterialItems, setStandardMaterialItems] = useState([]);
  const [materialsCollapsed, setMaterialsCollapsed] = useState(false);

  const isServiceJob = (checklist.installation_or_service || 'Installation') === 'Service' || checklist.job_type === 'Service';

  const [deviceConfigs, setDeviceConfigs] = useState(DEFAULT_CONFIGS);
  const [extraInstallations, setExtraInstallations] = useState([]);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        setFetchingData(true);
        setError('');

        // 1. Fetch catalogue products, pre-installation backup declaration, and device configurations
        const [products, backupDecl, configsData] = await Promise.all([
          fetchBackupProducts(token).catch(() => []),
          checklist?.id ? fetchBackupDeclaration(token, checklist.id).catch(() => null) : Promise.resolve(null),
          fetchDeviceConfigurations(token).catch(() => DEFAULT_CONFIGS),
        ]);

        if (!isMounted) return;
        setAvailableProducts(products);
        if (Array.isArray(configsData) && configsData.length > 0) {
          setDeviceConfigs(configsData);
        }

        // 2. Read-Only Mode: fetch existing completion report and populate rows
        if (readOnly && checklist?.id) {
          try {
            const [report, addlInst] = await Promise.all([
              fetchInstallationCompletionReport(token, checklist.id).catch(() => null),
              fetchAdditionalCustomerInstallations(token, checklist.id).catch(() => []),
            ]);
            if (isMounted && report) {
              setCompletionStatus(report.completion_status || 'Completed');
              setGeneralRemarks(report.remarks || '');

              if (Array.isArray(report.extra_installations) && report.extra_installations.length > 0) {
                setExtraInstallations(report.extra_installations);
              } else if (Array.isArray(addlInst) && addlInst.length > 0) {
                setExtraInstallations(addlInst);
              }

              // Required device items
              if (Array.isArray(report.items) && report.items.length > 0) {
                const reqRows = report.items.map((it, idx) => {
                  const reqQty = Number(it.required_quantity ?? it.standard_quantity ?? it.quantity_carried) || 0;
                  const instQty = Number(it.quantity_installed_required ?? it.quantity_installed) || 0;
                  return {
                    id: `rep-dev-${idx}`,
                    product_id: it.product_id || null,
                    device_type: it.device_type || it.item_name,
                    product_name: it.device_type || it.item_name,
                    unit: it.unit || 'Nos.',
                    required_quantity: reqQty,
                    actual_installed_quantity: instQty,
                    notes: it.discrepancy_reason || '',
                  };
                });
                setRequiredDeviceItems(reqRows);
              }

              // Extra backup items (strictly from report.backup_items or backup declaration)
              const rawBackup = (Array.isArray(report.backup_items) && report.backup_items.length > 0)
                ? report.backup_items
                : (backupDecl?.has_backup_items && Array.isArray(backupDecl.items) ? backupDecl.items : []);

              const bRows = rawBackup
                .filter((b) => !isScrewMaterial(b.item_name || b.material_name) && (Number(b.quantity_carried ?? b.quantity) || 0) > 0)
                .map((b, idx) => {
                  const carried = Number(b.quantity_carried ?? b.quantity) || 0;
                  return {
                    id: `rep-backup-${idx}`,
                    item_id: b.item_id || b.id || null,
                    item_name: b.item_name || b.material_name,
                    item_sku: b.item_sku || b.sku || '',
                    category: b.category || (isDeviceComponent(b.item_name || b.material_name) ? 'Device Component' : 'Installation Material'),
                    unit: b.unit || 'Nos.',
                    extra_carried: carried,
                    quantity_used: Number(b.quantity_used) || 0,
                    quantity_returned: Number(b.quantity_returned) || 0,
                    quantity_damaged: Number(b.quantity_damaged) || 0,
                    quantity_missing: Number(b.quantity_missing) || 0,
                    discrepancy_reason: b.discrepancy_reason || '',
                  };
                });
              setBackupItems(bRows);

              // Standard fitting materials
              if (Array.isArray(report.material_items) && report.material_items.length > 0) {
                const matRows = report.material_items
                  .filter((m) => !isScrewMaterial(m.material_name || m.item_name))
                  .map((m, idx) => ({
                    id: `rep-mat-${idx}`,
                    material_id: m.material_id || m.id || null,
                    material_name: m.material_name || m.item_name,
                    unit: m.unit || 'Nos.',
                    standard_quantity: Number(m.standard_quantity ?? m.quantity_issued) || 0,
                    quantity_used: Number(m.quantity_used) || 0,
                    quantity_returned: Number(m.quantity_returned) || 0,
                    remarks: m.remarks || '',
                  }));
                setStandardMaterialItems(matRows);
              }

              // Extra device installations
              if (Array.isArray(report.extra_installations) && report.extra_installations.length > 0) {
                setExtraInstallations(report.extra_installations);
              } else {
                try {
                  const extraList = await fetchAdditionalCustomerInstallations(token, checklist.id);
                  if (Array.isArray(extraList) && extraList.length > 0) {
                    setExtraInstallations(extraList);
                  }
                } catch (extraErr) {}
              }

              setFetchingData(false);
              return;
            }
          } catch (e) {
            console.warn('Failed to load read-only completion report:', e.message);
          }
        }

        // 3. New Post-Installation Entry
        // 3A. Customer-Required Installation Devices / Service Items
        let initialReqRows = [];
        if (isServiceJob) {
          const rawService = Array.isArray(checklist.service_items) ? checklist.service_items : [];
          const issuedServiceItems = rawService.filter((it) => (Number(it.quantity_issued) || 0) > 0);
          initialReqRows = issuedServiceItems.map((it, idx) => {
            const issuedQty = Number(it.quantity_issued) || 0;
            return {
              id: `req-service-${idx}-${Date.now()}`,
              product_id: it.item_id || null,
              device_type: it.item_name,
              product_name: it.item_name,
              sku: it.sku || '',
              unit: it.unit || 'Nos.',
              required_quantity: issuedQty,
              actual_installed_quantity: issuedQty, // default: all issued items used
              notes: it.service_note || '',
            };
          });
        } else {
          const configs = Array.isArray(checklist.device_configurations) && checklist.device_configurations.length > 0
            ? checklist.device_configurations
            : (checklist.device_type ? [{ device_type: checklist.device_type, number_of_devices: checklist.number_of_devices || 1, unit: 'Nos.' }] : []);

          initialReqRows = configs.map((cfg, idx) => {
            const devType = cfg.device_type || 'Standard Device';
            const count = Number(cfg.number_of_devices ?? cfg.quantity_carried ?? 1);
            const matchedProd = products.find((p) => (p.item_name || '').toLowerCase() === devType.toLowerCase());
            return {
              id: `req-dev-${idx}-${Date.now()}`,
              product_id: matchedProd?.id || null,
              device_type: devType,
              product_name: devType,
              sku: matchedProd?.sku || '',
              unit: cfg.unit || matchedProd?.unit || 'Nos.',
              required_quantity: count,
              actual_installed_quantity: count, // default: all required installed
              notes: '',
            };
          });

          if (initialReqRows.length === 0) {
            const defaultDev = products.find((p) => p.item_name === 'Camera') || products[0];
            initialReqRows.push({
              id: `req-dev-default`,
              product_id: defaultDev?.id || null,
              device_type: defaultDev ? defaultDev.item_name : 'Camera System',
              product_name: defaultDev ? defaultDev.item_name : 'Camera System',
              sku: defaultDev?.sku || '',
              unit: defaultDev?.unit || 'Nos.',
              required_quantity: 1,
              actual_installed_quantity: 1,
              notes: '',
            });
          }
        }
        setRequiredDeviceItems(initialReqRows);

        // 3B. Extra Backup Items strictly from Pre-Installation Declaration (screws excluded)
        let initialBackupRows = [];
        if (backupDecl && backupDecl.has_backup_items && Array.isArray(backupDecl.items)) {
          initialBackupRows = backupDecl.items
            .filter((b) => !isScrewMaterial(b.item_name) && (Number(b.quantity) || 0) > 0)
            .map((b, idx) => {
              const extraCarried = Number(b.quantity) || 0;
              const matchedProd = products.find(
                (p) => (p.item_name || '').toLowerCase() === (b.item_name || '').toLowerCase()
              );
              const isDev = isDeviceComponent(b.item_name) || b.category === 'Device Component';
              return {
                id: `backup-row-${idx}-${Date.now()}`,
                item_id: b.item_id || b.id || matchedProd?.id || null,
                item_name: b.item_name,
                item_sku: b.item_sku || matchedProd?.sku || '',
                category: isDev ? 'Device Component' : 'Installation Material',
                unit: b.unit || matchedProd?.unit || 'Nos.',
                extra_carried: extraCarried,
                quantity_used: 0,
                quantity_returned: extraCarried, // by default: all extra backup assumed returned unused
                quantity_damaged: 0,
                quantity_missing: 0,
                discrepancy_reason: '',
              };
            });
        }
        setBackupItems(initialBackupRows);

        // 3C. Standard Fitting Materials from preliminary BOM snapshot (screws excluded)
        let initialMatRows = [];
        if (!isServiceJob) {
          const prelimMaterials = checklist.bom_snapshot?.items || checklist.material_items || [];
          initialMatRows = prelimMaterials
            .filter((m) => {
              const name = (m.material_name || m.item_name || '').trim();
              return name && !isScrewMaterial(name) && !isDeviceComponent(name);
            })
            .map((m, idx) => {
              const name = (m.material_name || m.item_name || '').trim();
              const qty = Number(m.total_quantity !== undefined ? m.total_quantity : m.quantity) || 0;
              const matchedProd = products.find((p) => (p.item_name || '').toLowerCase() === name.toLowerCase());
              return {
                id: `mat-row-${idx}-${Date.now()}`,
                material_id: m.material_id || m.id || matchedProd?.id || null,
                material_name: name,
                unit: m.unit || matchedProd?.unit || 'Nos.',
                standard_quantity: qty,
                quantity_used: qty,
                quantity_returned: 0,
                remarks: '',
              };
            });
        }
        setStandardMaterialItems(initialMatRows);

        // Pre-load existing extra installations if any were previously recorded
        try {
          const extraList = await fetchAdditionalCustomerInstallations(token, checklist.id);
          if (Array.isArray(extraList) && extraList.length > 0) {
            setExtraInstallations(extraList);
          }
        } catch (e) {}
      } catch (err) {
        console.error('Failed to load completion form data:', err);
        if (isMounted) setError(err.message || 'Error loading form details');
      } finally {
        if (isMounted) setFetchingData(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [checklist, readOnly, token]);

  // Handlers for Customer-Required Devices
  const handleRequiredDeviceChange = (id, field, value) => {
    setRequiredDeviceItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        if (field === 'actual_installed_quantity') {
          const val = value === '' ? '' : Math.max(0, parseInt(value, 10) || 0);
          return { ...row, actual_installed_quantity: val };
        }
        return { ...row, [field]: value };
      })
    );
  };

  // Handlers for Extra Backup Items Carried
  const handleBackupItemChange = (id, field, value) => {
    setBackupItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        if (
          field === 'quantity_used' ||
          field === 'quantity_returned' ||
          field === 'quantity_damaged' ||
          field === 'quantity_missing'
        ) {
          const val = value === '' ? '' : Math.max(0, parseFloat(value) || 0);
          return { ...row, [field]: val };
        }
        return { ...row, [field]: value };
      })
    );
  };

  // Handlers for Standard Fitting Materials
  const handleStandardMaterialChange = (id, field, value) => {
    setStandardMaterialItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        if (field === 'quantity_used' || field === 'quantity_returned') {
          const val = value === '' ? '' : Math.max(0, parseFloat(value) || 0);
          return { ...row, [field]: val };
        }
        return { ...row, [field]: value };
      })
    );
  };

  // Extra Device Installations Handlers
  const handleAddExtraInstallation = () => {
    const defaultConf = deviceConfigs[0]?.device_type || '4 Channel Live';
    const components = getComponentBreakdownForConfig(defaultConf, deviceConfigs);
    const newInst = {
      id: `extra-inst-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      recipient_customer_type: 'SAME_CUSTOMER',
      recipient_customer_name: checklist.client_name || '',
      recipient_mobile: checklist.client_mobile || '',
      installation_location: checklist.client_location || '',
      maps_link: '',
      installation_date: new Date().toISOString().split('T')[0],
      device_configuration: defaultConf,
      components_used: components,
      materials_used: [],
      notes: '',
    };
    setExtraInstallations((prev) => [...prev, newInst]);
  };

  const handleRemoveExtraInstallation = (id) => {
    setExtraInstallations((prev) => prev.filter((inst) => inst.id !== id));
  };

  const handleExtraInstallationChange = (id, field, value) => {
    setExtraInstallations((prev) =>
      prev.map((inst) => {
        if (inst.id !== id) return inst;
        if (field === 'recipient_customer_type') {
          if (value === 'SAME_CUSTOMER') {
            return {
              ...inst,
              recipient_customer_type: 'SAME_CUSTOMER',
              recipient_customer_name: checklist.client_name || '',
              recipient_mobile: checklist.client_mobile || '',
              installation_location: checklist.client_location || '',
            };
          } else {
            return {
              ...inst,
              recipient_customer_type: 'ANOTHER_CUSTOMER',
              recipient_customer_name: '',
              recipient_mobile: '',
              installation_location: '',
            };
          }
        }
        if (field === 'device_configuration') {
          const newComponents = getComponentBreakdownForConfig(value, deviceConfigs);
          return {
            ...inst,
            device_configuration: value,
            components_used: newComponents,
          };
        }
        return { ...inst, [field]: value };
      })
    );
  };

  const handleExtraInstallationComponentChange = (instId, compIndex, field, value) => {
    setExtraInstallations((prev) =>
      prev.map((inst) => {
        if (inst.id !== instId) return inst;
        const comps = [...inst.components_used];
        if (comps[compIndex]) {
          comps[compIndex] = {
            ...comps[compIndex],
            [field]: field === 'quantity' ? Math.max(0, parseFloat(value) || 0) : value,
          };
        }
        return { ...inst, components_used: comps };
      })
    );
  };

  // Sync Extra Component Usage directly into Extra Backup Items
  const handleSyncExtraToBackupUsage = () => {
    const extraCompTotals = new Map();
    extraInstallations.forEach((inst) => {
      (inst.components_used || []).forEach((c) => {
        const key = (c.component_name || '').toLowerCase().trim();
        const current = extraCompTotals.get(key) || 0;
        extraCompTotals.set(key, current + (Number(c.quantity) || 0));
      });
    });

    setBackupItems((prev) =>
      prev.map((row) => {
        const key = (row.item_name || '').toLowerCase().trim();
        let extraUsed = 0;
        if (extraCompTotals.has(key)) {
          extraUsed = extraCompTotals.get(key);
        } else {
          for (const [k, v] of extraCompTotals.entries()) {
            if (k.includes(key) || key.includes(k)) {
              extraUsed = v;
              break;
            }
          }
        }

        const carried = Number(row.extra_carried) || 0;
        const dam = Number(row.quantity_damaged) || 0;
        const mis = Number(row.quantity_missing) || 0;
        const newReturned = Math.max(0, carried - extraUsed - dam - mis);

        return {
          ...row,
          quantity_used: extraUsed,
          quantity_returned: newReturned,
        };
      })
    );
  };

  // Extra backup item status
  const getBackupItemStats = (row) => {
    const carried = Number(row.extra_carried) || 0;
    const used = Number(row.quantity_used) || 0;
    const returned = Number(row.quantity_returned) || 0;
    const damaged = Number(row.quantity_damaged) || 0;
    const missing = Number(row.quantity_missing) || 0;

    const hasNegative = used < 0 || returned < 0 || damaged < 0 || missing < 0;
    const totalAccounted = used + returned + damaged + missing;
    const isBalanced = !hasNegative && totalAccounted === carried;
    const hasDiscrepancyRemark = (damaged === 0 && missing === 0) || Boolean(row.discrepancy_reason?.trim());

    return {
      carried,
      used,
      returned,
      damaged,
      missing,
      hasNegative,
      totalAccounted,
      isBalanced,
      hasDiscrepancyRemark,
    };
  };

  // Overall form validation
  const validateForm = () => {
    // 1. Required Devices validation
    if (!isServiceJob && requiredDeviceItems.length === 0) {
      return 'Please record at least one customer-required installation device.';
    }
    for (const dev of requiredDeviceItems) {
      const req = Number(dev.required_quantity) || 0;
      const inst = Number(dev.actual_installed_quantity);
      if (isNaN(inst) || inst < 0) {
        return `Actual installed quantity for required device "${dev.product_name}" cannot be negative.`;
      }
      if (inst > req) {
        return `Actual installed quantity (${inst}) cannot exceed required quantity (${req}) for "${dev.product_name}". Extra installations must be recorded using extra backup items.`;
      }
    }

    // 2. Extra Backup Items validation
    for (const item of backupItems) {
      const stats = getBackupItemStats(item);
      if (stats.hasNegative) {
        return `Quantities for extra backup item "${item.item_name}" cannot be negative numbers.`;
      }
      if (stats.used > stats.carried) {
        return `Extra used quantity (${stats.used}) cannot exceed extra carried (${stats.carried}) for "${item.item_name}".`;
      }
      if (stats.returned > stats.carried) {
        return `Extra returned quantity (${stats.returned}) cannot exceed extra carried (${stats.carried}) for "${item.item_name}".`;
      }
      if (!stats.isBalanced) {
        return `Reconciliation mismatch for extra backup "${item.item_name}": Extra Carried (${stats.carried}) must equal Extra Used (${stats.used}) + Extra Returned (${stats.returned}) + Extra Damaged (${stats.damaged}) + Extra Missing (${stats.missing}). Currently totals ${stats.totalAccounted}.`;
      }
      if (!stats.hasDiscrepancyRemark) {
        return `Discrepancy explanation remark is required for extra backup "${item.item_name}" because damaged (${stats.damaged}) or missing (${stats.missing}) items were recorded.`;
      }
    }

    // 3. Extra Device Installations validation
    for (let i = 0; i < extraInstallations.length; i++) {
      const inst = extraInstallations[i];
      if (!inst.recipient_customer_name || !inst.recipient_customer_name.trim()) {
        return `Extra Installation #${i + 1}: Recipient customer name is required.`;
      }
      if (!inst.installation_date) {
        return `Extra Installation #${i + 1}: Installation date is required.`;
      }
      if (!Array.isArray(inst.components_used) || inst.components_used.length === 0) {
        return `Extra Installation #${i + 1}: At least one component must be recorded as used.`;
      }
      for (const comp of inst.components_used) {
        if (!comp.component_name || !comp.component_name.trim()) {
          return `Extra Installation #${i + 1}: Component name is required.`;
        }
        const q = Number(comp.quantity);
        if (isNaN(q) || q <= 0) {
          return `Extra Installation #${i + 1} (${comp.component_name}): Component quantity must be a positive number.`;
        }
      }
    }

    // Check total component allocation across extra installations doesn't exceed backup carried
    const extraCompTotals = new Map();
    extraInstallations.forEach((inst) => {
      (inst.components_used || []).forEach((c) => {
        const key = (c.component_name || '').toLowerCase().trim();
        const cur = extraCompTotals.get(key) || 0;
        extraCompTotals.set(key, cur + (Number(c.quantity) || 0));
      });
    });

    for (const [key, totalAlloc] of extraCompTotals.entries()) {
      const matchedBackup = backupItems.find((b) => {
        const bKey = (b.item_name || '').toLowerCase().trim();
        return bKey === key || key.includes(bKey) || bKey.includes(key);
      });
      const carried = matchedBackup ? Number(matchedBackup.extra_carried) || 0 : 0;
      if (matchedBackup && totalAlloc > carried) {
        return `Total allocated ${matchedBackup.item_name} across extra installations (${totalAlloc}) exceeds extra carried (${carried}).`;
      }
    }

    // 4. Standard Materials validation
    for (const mat of standardMaterialItems) {
      const u = Number(mat.quantity_used) || 0;
      const r = Number(mat.quantity_returned) || 0;
      if (u < 0 || r < 0) {
        return `Quantities for material "${mat.material_name}" cannot be negative.`;
      }
    }

    return null;
  };

  const isFormBalanced =
    backupItems.length === 0 ||
    backupItems.every((item) => {
      const stats = getBackupItemStats(item);
      return stats.isBalanced && stats.hasDiscrepancyRemark;
    });

  // Form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validationErr = validateForm();
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setLoading(true);

    try {
      const payload = {
        items: requiredDeviceItems.map((d) => {
          const req = Number(d.required_quantity) || 0;
          const inst = Number(d.actual_installed_quantity) || 0;
          const unused = Math.max(0, req - inst);
          return {
            product_id: d.product_id || null,
            device_type: d.device_type || d.product_name,
            item_name: d.product_name,
            unit: d.unit || 'Nos.',
            category: 'Device Component',
            required_quantity: req,
            standard_quantity: req,
            quantity_carried: req,
            quantity_installed: inst,
            quantity_installed_required: inst,
            quantity_installed_extra: 0,
            quantity_to_return: unused,
            quantity_damaged: 0,
            quantity_missing: 0,
            discrepancy_reason: d.notes ? d.notes.trim() : null,
          };
        }),
        material_items: standardMaterialItems
          .filter((m) => !isScrewMaterial(m.material_name))
          .map((m) => ({
            material_id: m.material_id || null,
            material_name: m.material_name,
            unit: m.unit || 'Nos.',
            standard_quantity: Number(m.standard_quantity) || 0,
            quantity_issued: Number(m.standard_quantity) || 0,
            quantity_used: Number(m.quantity_used) || 0,
            quantity_returned: Number(m.quantity_returned) || 0,
            quantity_damaged: 0,
            quantity_missing: 0,
            remarks: m.remarks ? m.remarks.trim() : null,
          })),
        backup_items: backupItems
          .filter((it) => (Number(it.extra_carried) || 0) > 0 && !isScrewMaterial(it.item_name))
          .map((b) => ({
            item_name: b.item_name,
            unit: b.unit || 'Nos.',
            category: b.category,
            quantity_carried: Number(b.extra_carried) || 0,
            quantity_used: Number(b.quantity_used) || 0,
            quantity_returned: Number(b.quantity_returned) || 0,
            quantity_damaged: Number(b.quantity_damaged) || 0,
            quantity_missing: Number(b.quantity_missing) || 0,
            discrepancy_reason: b.discrepancy_reason ? b.discrepancy_reason.trim() : null,
          })),
        extra_installations: extraInstallations,
        completion_status: completionStatus,
        remarks: generalRemarks.trim() || null,
      };

      const result = await submitInstallationCompletionReport(token, checklist.id, payload);
      if (onSuccess) {
        onSuccess(result);
      }
    } catch (err) {
      console.error('Error submitting completion report:', err);
      setError(err.message || 'Failed to submit post-installation report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-purple-50/60 via-white to-purple-50/30">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-purple-600 text-white shadow-xs">
              <FileCheck className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
                {readOnly ? 'Post-Installation Completion Details' : 'Post-Installation Completion Form'}
                {readOnly && (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    Read-Only
                  </span>
                )}
              </h3>
              <p className="text-xs text-gray-500">
                Checklist #{checklist.checklist_number || checklist.id?.substring(0, 8)} • {checklist.client_name}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Metadata Card */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <span className="text-gray-400 block text-[10px] font-semibold uppercase">Client</span>
                <span className="font-semibold text-gray-800 truncate block">{checklist.client_name}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px] font-semibold uppercase">Required Vehicles</span>
                <span className="font-semibold text-gray-800 block">
                  {checklist.number_of_vehicles || checklist.number_of_devices || 1} Vehicle(s)
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px] font-semibold uppercase">Technician</span>
                <span className="font-semibold text-gray-800 truncate block">{checklist.service_engineer || 'Unassigned'}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px] font-semibold uppercase">Job Type</span>
                <span className="font-semibold text-gray-800 block">{checklist.installation_or_service || 'Installation'}</span>
              </div>
            </div>
          </div>

          {/* Informational Guidance */}
          {!readOnly && (
            <div className="p-3 bg-purple-50/80 border border-purple-200 rounded-xl text-xs text-purple-950 flex items-start gap-2">
              <Info className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                <strong>Separate Tracking Rule:</strong> Customer-required installation devices are verified in Section 1. Extra loose backup items carried by the technician are tracked separately in Section 2 (Usage & Returns). Customer device counts are never included in extra backup return equations.
              </div>
            </div>
          )}

          {/* Error Notification */}
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {fetchingData ? (
            <div className="py-12 text-center text-gray-500 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-7 h-7 animate-spin text-purple-600" />
              <span className="text-xs font-medium">Loading checklist devices and backup declarations...</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 text-xs">
              {/* ============================================================
                  SECTION 1: CUSTOMER-REQUIRED INSTALLATION DEVICES / SERVICE ITEMS
                  ============================================================ */}
              <div className="space-y-3">
                <div className="border-b border-gray-100 pb-2">
                  <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-blue-600" />
                    {isServiceJob ? 'Service Items Used & Reconciled' : 'Customer-Required Installation Devices'}
                  </h4>
                  <p className="text-[11px] text-gray-500">
                    {isServiceJob
                      ? 'Verify the actual quantity of issued service items used on site. Any unused items will be declared for return.'
                      : 'Verify the actual quantity of customer devices installed on site. Required devices are kept strictly separate from extra backup returns.'}
                  </p>
                </div>

                {isServiceJob && requiredDeviceItems.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-gray-600 text-xs space-y-1">
                    <CheckCircle2 className="w-5 h-5 mx-auto text-purple-600" />
                    <span className="font-bold text-gray-800 block">Direct Service Call — No Stock Issued</span>
                    <span className="text-[11px] text-gray-500 block">
                      No items were issued from the store for this service job. Enter your service notes below to complete the report.
                    </span>
                  </div>
                ) : (
                <div className="space-y-2.5">
                  {requiredDeviceItems.map((row) => {
                    const req = Number(row.required_quantity) || 0;
                    const inst = Number(row.actual_installed_quantity) || 0;
                    const isFull = inst >= req;
                    const isPartial = inst < req && inst > 0;

                    return (
                      <div
                        key={row.id}
                        className="p-3.5 bg-white border border-gray-200 rounded-xl shadow-2xs space-y-2.5"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                            <span className="font-bold text-gray-900 text-xs">{row.product_name}</span>
                            {row.sku && <span className="text-[10px] text-gray-400 font-mono">({row.sku})</span>}
                            <span className="text-[10px] text-gray-500 font-mono font-normal">
                              • {isServiceJob ? 'Service Carry Item' : 'Customer Requirement'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {isFull ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                                <CheckCircle2 size={12} className="text-emerald-600" /> {isServiceJob ? 'Fully Used' : 'Fully Installed'} ({inst}/{req})
                              </span>
                            ) : isPartial ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                                <AlertTriangle size={12} className="text-amber-600" /> {isServiceJob ? 'Partially Used' : 'Partial Installation'} ({inst}/{req})
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                                <AlertTriangle size={12} className="text-rose-600" /> {isServiceJob ? 'Not Used (Returned)' : 'Not Installed'} (0/{req})
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              {isServiceJob ? 'Quantity Issued to Technician' : 'Customer Required Quantity'}
                            </label>
                            <div className="w-full text-xs p-1.5 border border-gray-200 rounded-lg text-center font-mono font-bold bg-gray-50 text-gray-800">
                              {req} {row.unit}
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              {isServiceJob ? 'Quantity Used on Site' : 'Actual Installed Quantity'} <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="number"
                              min="0"
                              max={req}
                              step="1"
                              disabled={readOnly}
                              value={row.actual_installed_quantity}
                              onChange={(e) =>
                                handleRequiredDeviceChange(row.id, 'actual_installed_quantity', e.target.value)
                              }
                              className="w-full text-xs p-1.5 border border-emerald-300 rounded-lg text-center font-mono font-bold text-emerald-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-gray-100"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              {isServiceJob ? 'Service Reconciliation' : 'Installation Reconciliation'}
                            </label>
                            <div className="w-full text-xs p-1.5 border border-gray-200 rounded-lg text-center font-semibold bg-gray-50 text-gray-700">
                              {isFull ? (isServiceJob ? '100% Used on Site' : '100% Installed') : (isServiceJob ? `${inst} Used, ${req - inst} Returned` : `${inst} of ${req} Installed`)}
                            </div>
                          </div>
                        </div>

                        {inst < req && (
                          <div className="pt-1">
                            <label className="block text-[10px] font-semibold text-amber-800 mb-0.5 uppercase tracking-wide">
                              {isServiceJob ? 'Unused Return Note' : 'Shortfall Reason / Uninstalled Note'} <span className="text-amber-600 font-normal">(Optional)</span>
                            </label>
                            <input
                              type="text"
                              disabled={readOnly}
                              value={row.notes || ''}
                              onChange={(e) => handleRequiredDeviceChange(row.id, 'notes', e.target.value)}
                              placeholder={isServiceJob ? 'e.g. Existing camera was intact; returned 1 unused unit to store...' : 'e.g. 1 client vehicle was unavailable at site during installation...'}
                              className="w-full text-xs px-2.5 py-1.5 border border-amber-300 rounded-lg bg-amber-50/30 text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-gray-100"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
              </div>

              {/* ============================================================
                  SECTION 2: EXTRA BACKUP ITEMS CARRIED — USAGE & RETURNS
                  ============================================================ */}
              <div className="space-y-3">
                <div className="border-b border-gray-100 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                  <div>
                    <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-purple-600" />
                      Extra Backup Items Carried — Usage & Returns
                      {backupItems.length > 0 && (
                        <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-100 text-amber-900 rounded-full">
                          {backupItems.length} declared item{backupItems.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-gray-500">
                      Reconcile extra backup items declared in the Pre-Installation Form. Reconciliation rule: <strong>Extra Carried = Extra Used + Extra Returned + Extra Damaged + Extra Missing</strong>.
                    </p>
                  </div>
                </div>

                {backupItems.length === 0 ? (
                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl text-center text-gray-500 text-xs space-y-1">
                    <Package className="w-6 h-6 mx-auto text-slate-400 opacity-60" />
                    <span className="font-bold text-gray-800 block text-xs">No Extra Backup Items Declared</span>
                    <span className="text-[11px] text-gray-500 block max-w-md mx-auto">
                      No extra backup items were declared for this job in the Pre-Installation Form. All devices and materials carried are standard customer-required installation items.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {backupItems.map((row) => {
                      const stats = getBackupItemStats(row);

                      return (
                        <div
                          key={row.id}
                          className={`p-3.5 rounded-xl border transition-all ${
                            stats.isBalanced
                              ? 'bg-white border-gray-200 shadow-2xs'
                              : 'bg-rose-50/40 border-rose-200 shadow-xs'
                          } space-y-2.5`}
                        >
                          {/* Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                              <span className="font-bold text-gray-900 text-xs">{row.item_name}</span>
                              {row.item_sku && (
                                <span className="text-[10px] text-gray-400 font-mono">({row.item_sku})</span>
                              )}
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">
                                {row.category}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-amber-100 text-amber-950 border border-amber-300">
                                Extra Carried: <strong className="text-amber-900">{stats.carried}</strong> {row.unit}
                              </span>

                              {stats.isBalanced ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                                  <CheckCircle2 size={12} className="text-emerald-600" /> Balanced
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                                  <AlertTriangle size={12} className="text-rose-600" />
                                  Unbalanced ({stats.totalAccounted}/{stats.carried})
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Inputs Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                                Extra Used on Site <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="number"
                                min="0"
                                max={stats.carried}
                                step="any"
                                disabled={readOnly}
                                value={row.quantity_used}
                                onChange={(e) => handleBackupItemChange(row.id, 'quantity_used', e.target.value)}
                                className="w-full text-xs p-1.5 border border-purple-300 rounded-lg text-center font-mono font-bold text-purple-700 bg-white focus:ring-2 focus:ring-purple-500 outline-none disabled:bg-gray-100"
                                required
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                                Extra Returned Unused <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="number"
                                min="0"
                                max={stats.carried}
                                step="any"
                                disabled={readOnly}
                                value={row.quantity_returned}
                                onChange={(e) => handleBackupItemChange(row.id, 'quantity_returned', e.target.value)}
                                className="w-full text-xs p-1.5 border border-blue-300 rounded-lg text-center font-mono font-bold text-blue-700 bg-white focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100"
                                required
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                                Extra Damaged
                              </label>
                              <input
                                type="number"
                                min="0"
                                max={stats.carried}
                                step="any"
                                disabled={readOnly}
                                value={row.quantity_damaged}
                                onChange={(e) => handleBackupItemChange(row.id, 'quantity_damaged', e.target.value)}
                                className="w-full text-xs p-1.5 border border-amber-300 rounded-lg text-center font-mono font-bold text-amber-700 bg-white focus:ring-2 focus:ring-amber-500 outline-none disabled:bg-gray-100"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                                Extra Missing
                              </label>
                              <input
                                type="number"
                                min="0"
                                max={stats.carried}
                                step="any"
                                disabled={readOnly}
                                value={row.quantity_missing}
                                onChange={(e) => handleBackupItemChange(row.id, 'quantity_missing', e.target.value)}
                                className="w-full text-xs p-1.5 border border-rose-300 rounded-lg text-center font-mono font-bold text-rose-700 bg-white focus:ring-2 focus:ring-rose-500 outline-none disabled:bg-gray-100"
                              />
                            </div>

                            <div className="col-span-2 sm:col-span-1">
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                                Unit
                              </label>
                              <div className="w-full text-xs p-1.5 border border-gray-200 rounded-lg text-center font-mono font-semibold bg-gray-50 text-gray-700">
                                {row.unit || 'Nos.'}
                              </div>
                            </div>
                          </div>

                          {/* Discrepancy explanation */}
                          {(stats.damaged > 0 || stats.missing > 0) && (
                            <div className="pt-1">
                              <label className="block text-[11px] font-semibold text-rose-800 mb-1">
                                Discrepancy Explanation for {row.item_name} <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="text"
                                disabled={readOnly}
                                value={row.discrepancy_reason || ''}
                                onChange={(e) => handleBackupItemChange(row.id, 'discrepancy_reason', e.target.value)}
                                placeholder="Explain damage during transit or site loss..."
                                className="w-full text-xs px-2.5 py-1.5 border border-rose-300 rounded-lg bg-white text-gray-800 outline-none focus:ring-2 focus:ring-rose-500 disabled:bg-gray-100"
                                required
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ============================================================
                  SECTION 3: STANDARD FITTING MATERIALS USAGE (COLLAPSIBLE)
                  ============================================================ */}
              {!isServiceJob && (
              <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                <div className="p-3 bg-slate-50 flex items-center justify-between border-b border-gray-200">
                  <button
                    type="button"
                    onClick={() => setMaterialsCollapsed(!materialsCollapsed)}
                    className="flex items-center gap-2 text-left cursor-pointer focus:outline-none flex-1"
                  >
                    <Layers className="w-4 h-4 text-blue-600" />
                    <div>
                      <span className="font-bold text-gray-900 text-xs block">
                        Standard Fitting Materials Usage
                      </span>
                      <span className="text-[11px] text-gray-500">
                        Tape, cable ties, wire, and other installation materials from configured BOM ({standardMaterialItems.length} items)
                      </span>
                    </div>
                    {materialsCollapsed ? (
                      <ChevronDown className="w-4 h-4 text-gray-400 ml-1" />
                    ) : (
                      <ChevronUp className="w-4 h-4 text-gray-400 ml-1" />
                    )}
                  </button>
                </div>

                {!materialsCollapsed && (
                  <div className="p-3.5 space-y-2.5 bg-slate-50/50">
                    {standardMaterialItems.length === 0 ? (
                      <div className="p-4 bg-white border border-dashed border-gray-200 rounded-xl text-center text-gray-400 text-xs italic">
                        No standard fitting materials specified in BOM for this job.
                      </div>
                    ) : (
                      standardMaterialItems.map((mat) => (
                        <div
                          key={mat.id}
                          className="p-3 bg-white border border-gray-200 rounded-xl shadow-2xs space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-gray-900 text-xs">{mat.material_name}</span>
                            <span className="text-[11px] font-mono font-semibold text-gray-600 bg-slate-100 px-2 py-0.5 rounded">
                              Standard BOM: {mat.standard_quantity} {mat.unit}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                                Standard Used on Site
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                disabled={readOnly}
                                value={mat.quantity_used}
                                onChange={(e) =>
                                  handleStandardMaterialChange(mat.id, 'quantity_used', e.target.value)
                                }
                                className="w-full text-xs p-1.5 border border-gray-300 rounded-lg text-center font-mono font-bold text-gray-800 bg-white focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                                Standard Returned Unused
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                disabled={readOnly}
                                value={mat.quantity_returned}
                                onChange={(e) =>
                                  handleStandardMaterialChange(mat.id, 'quantity_returned', e.target.value)
                                }
                                className="w-full text-xs p-1.5 border border-gray-300 rounded-lg text-center font-mono font-bold text-blue-700 bg-white focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100"
                              />
                            </div>

                            <div className="col-span-2 sm:col-span-1">
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                                Unit
                              </label>
                              <div className="w-full text-xs p-1.5 border border-gray-200 rounded-lg text-center font-mono font-semibold bg-gray-50 text-gray-700">
                                {mat.unit || 'Nos.'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              )}

              {/* ============================================================
                  SECTION 4: EXTRA DEVICE INSTALLATIONS (ADDITIONAL CUSTOMERS)
                  ============================================================ */}
              <div className="border border-purple-200/80 rounded-2xl overflow-hidden bg-gradient-to-b from-purple-50/40 to-white shadow-2xs">
                <div className="p-3.5 bg-gradient-to-r from-purple-100/60 to-purple-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-purple-100">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-purple-600 text-white shadow-2xs">
                      <Truck className="w-4 h-4" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                        Extra Device Installations
                        {extraInstallations.length > 0 && (
                          <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-purple-200 text-purple-900 rounded-full">
                            {extraInstallations.length} recorded
                          </span>
                        )}
                      </h4>
                      <p className="text-[11px] text-gray-600">
                        Record any additional device configurations installed using extra loose stock carried (for the original customer or another customer).
                      </p>
                    </div>
                  </div>

                  {!readOnly && (
                    <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                      {extraInstallations.length > 0 && backupItems.length > 0 && (
                        <button
                          type="button"
                          onClick={handleSyncExtraToBackupUsage}
                          className="px-2.5 py-1.5 text-xs font-semibold text-purple-700 bg-purple-100/80 hover:bg-purple-200 border border-purple-300 rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                          title="Auto-update component usage in the extra backup returns table above"
                        >
                          <RefreshCw size={12} /> Auto-Sync to Extra Returns Table
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleAddExtraInstallation}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                      >
                        <Plus size={14} /> Add Extra Installation
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-3.5 space-y-3">
                  {/* Live Extra Stock Allocation Summary */}
                  {backupItems.length > 0 && (
                    <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl space-y-1.5 text-xs">
                      <span className="text-[11px] font-bold text-purple-900 uppercase tracking-wide block">
                        Extra Loose Stock Allocation Summary
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {backupItems
                          .filter((b) => Number(b.extra_carried) > 0)
                          .map((b) => {
                            const key = (b.item_name || '').toLowerCase().trim();
                            let allocated = 0;
                            extraInstallations.forEach((inst) => {
                              (inst.components_used || []).forEach((c) => {
                                const cKey = (c.component_name || '').toLowerCase().trim();
                                if (cKey === key || cKey.includes(key) || key.includes(cKey)) {
                                  allocated += Number(c.quantity) || 0;
                                }
                              });
                            });
                            const carried = Number(b.extra_carried) || 0;
                            const remaining = carried - allocated;
                            const isOver = remaining < 0;

                            return (
                              <div
                                key={b.id}
                                className={`p-2 rounded-lg border text-xs ${
                                  isOver
                                    ? 'bg-rose-50 border-rose-300 text-rose-900'
                                    : 'bg-white border-purple-100 text-purple-950'
                                }`}
                              >
                                <span className="font-bold block truncate">{b.item_name}</span>
                                <div className="text-[11px] flex justify-between mt-1">
                                  <span className="text-gray-500">Carried: {carried}</span>
                                  <span className="font-semibold text-purple-700">Allocated: {allocated}</span>
                                </div>
                                <div className="text-[11px] mt-0.5 pt-0.5 border-t border-purple-100 flex justify-between font-mono font-bold">
                                  <span>Remaining:</span>
                                  <span className={isOver ? 'text-rose-700' : 'text-emerald-700'}>
                                    {remaining} {b.unit}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {extraInstallations.length === 0 ? (
                    <div className="p-4 bg-white border border-dashed border-purple-200 rounded-xl text-center text-gray-500 text-xs">
                      <Package className="w-5 h-5 mx-auto mb-1 text-purple-400 opacity-60" />
                      <span className="font-semibold text-gray-700 block">No Extra Device Installations Recorded</span>
                      <span className="text-[11px] text-gray-400 block mt-0.5">
                        If extra loose stock was used to install cameras/displays for the same customer or another customer, click &ldquo;+ Add Extra Installation&rdquo;.
                      </span>
                    </div>
                  ) : (
                    extraInstallations.map((inst, idx) => (
                      <div key={inst.id} className="p-3.5 bg-white border border-purple-200 rounded-xl shadow-2xs space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs text-gray-800 flex items-center gap-1">
                              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-800 font-mono text-[11px] flex items-center justify-center font-bold">
                                {idx + 1}
                              </span>
                              Extra Installation #{idx + 1}
                            </span>

                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                inst.recipient_customer_type === 'SAME_CUSTOMER'
                                  ? 'bg-purple-100 text-purple-900 border border-purple-200'
                                  : 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                              }`}
                            >
                              {inst.recipient_customer_type === 'SAME_CUSTOMER' ? 'Original Customer' : 'Another Customer'}
                            </span>

                            {inst.device_configuration && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                                {inst.device_configuration}
                              </span>
                            )}
                          </div>

                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleRemoveExtraInstallation(inst.id)}
                              className="text-gray-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                              title="Remove this extra installation"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              Recipient Customer Type <span className="text-rose-500">*</span>
                            </label>
                            <select
                              disabled={readOnly}
                              value={inst.recipient_customer_type}
                              onChange={(e) => handleExtraInstallationChange(inst.id, 'recipient_customer_type', e.target.value)}
                              className="w-full text-xs p-1.5 border border-gray-300 rounded-lg bg-white font-medium text-gray-900 outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                            >
                              <option value="SAME_CUSTOMER">Same customer as original checklist</option>
                              <option value="ANOTHER_CUSTOMER">Another customer</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              Recipient Customer Name <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              disabled={readOnly}
                              value={inst.recipient_customer_name}
                              onChange={(e) => handleExtraInstallationChange(inst.id, 'recipient_customer_name', e.target.value)}
                              placeholder="Customer / business name..."
                              className="w-full text-xs p-1.5 border border-gray-300 rounded-lg bg-white font-medium text-gray-900 outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              Installation Date <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="date"
                              disabled={readOnly}
                              value={inst.installation_date}
                              onChange={(e) => handleExtraInstallationChange(inst.id, 'installation_date', e.target.value)}
                              className="w-full text-xs p-1.5 border border-gray-300 rounded-lg bg-white font-medium text-gray-900 outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              Customer Mobile <span className="text-gray-400 font-normal">(Optional)</span>
                            </label>
                            <input
                              type="text"
                              disabled={readOnly}
                              value={inst.recipient_mobile || ''}
                              onChange={(e) => handleExtraInstallationChange(inst.id, 'recipient_mobile', e.target.value)}
                              placeholder="Mobile number..."
                              className="w-full text-xs p-1.5 border border-gray-300 rounded-lg bg-white font-medium text-gray-900 outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              Installation Location <span className="text-gray-400 font-normal">(Optional)</span>
                            </label>
                            <input
                              type="text"
                              disabled={readOnly}
                              value={inst.installation_location || ''}
                              onChange={(e) => handleExtraInstallationChange(inst.id, 'installation_location', e.target.value)}
                              placeholder="Depot / Site Address..."
                              className="w-full text-xs p-1.5 border border-gray-300 rounded-lg bg-white font-medium text-gray-900 outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              Google Maps Link <span className="text-gray-400 font-normal">(Optional)</span>
                            </label>
                            <input
                              type="url"
                              disabled={readOnly}
                              value={inst.maps_link || ''}
                              onChange={(e) => handleExtraInstallationChange(inst.id, 'maps_link', e.target.value)}
                              placeholder="https://maps.google.com/?q=..."
                              className="w-full text-xs p-1.5 border border-gray-300 rounded-lg bg-white font-medium text-gray-900 outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
                              Recipient Checklist <span className="text-gray-400 font-normal">(Optional)</span>
                            </label>
                            <input
                              type="text"
                              disabled={readOnly}
                              value={inst.recipient_checklist_number || ''}
                              onChange={(e) => handleExtraInstallationChange(inst.id, 'recipient_checklist_number', e.target.value)}
                              placeholder="e.g. EE-INST-20261022-0099 or leave blank"
                              className="w-full text-xs p-1.5 border border-gray-300 rounded-lg bg-white font-mono text-gray-900 outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                            />
                          </div>
                        </div>

                        <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-2">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-[11px] font-bold text-gray-800 uppercase tracking-wide">
                                Configuration:
                              </label>
                              <select
                                disabled={readOnly}
                                value={inst.device_configuration || '4 Channel Live'}
                                onChange={(e) => handleExtraInstallationChange(inst.id, 'device_configuration', e.target.value)}
                                className="text-xs py-1 px-2.5 border border-purple-300 rounded-lg bg-white font-bold text-purple-900 outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer disabled:bg-gray-100"
                              >
                                {deviceConfigs.map((cfg) => (
                                  <option key={cfg.device_type} value={cfg.device_type}>
                                    {cfg.device_type}
                                  </option>
                                ))}
                                <option value="Custom">Custom Component Configuration</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                            {inst.components_used?.map((comp, cIdx) => (
                              <div
                                key={cIdx}
                                className="p-2 bg-white rounded-lg border border-gray-200 flex items-center justify-between shadow-2xs"
                              >
                                <div className="truncate pr-1">
                                  <span className="font-semibold text-gray-800 text-xs block truncate">
                                    {comp.component_name}
                                  </span>
                                  <span className="text-[10px] text-gray-400 font-mono">{comp.unit || 'Nos.'}</span>
                                </div>
                                <input
                                  type="number"
                                  min="1"
                                  disabled={readOnly}
                                  value={comp.quantity}
                                  onChange={(e) =>
                                    handleExtraInstallationComponentChange(inst.id, cIdx, 'quantity', e.target.value)
                                  }
                                  className="w-14 text-xs p-1 border border-purple-200 rounded text-center font-mono font-bold text-purple-700 bg-purple-50/50 outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* ============================================================
                  SECTION 5: RECONCILIATION SUMMARY BANNER
                  ============================================================ */}
              <div
                className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isFormBalanced
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                    : 'bg-rose-50 border-rose-200 text-rose-950'
                }`}
              >
                <div>
                  <span className="font-bold flex items-center gap-1.5">
                    {isFormBalanced ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                    )}
                    {isFormBalanced
                      ? 'Reconciliation Status: Balanced & Ready'
                      : 'Extra Backup Reconciliation Discrepancy Detected'}
                  </span>
                  <span className="text-[11px] opacity-80 block mt-0.5">
                    {isFormBalanced
                      ? 'Customer required devices and extra backup return quantities are verified. Ready for report submission.'
                      : 'For every extra backup item, Extra Carried must equal Used + Returned + Damaged + Missing before submitting.'}
                  </span>
                </div>

                <div className="text-[11px] font-mono font-bold shrink-0">
                  {isFormBalanced ? (
                    <span className="text-emerald-700">100% Balanced</span>
                  ) : (
                    <span className="text-rose-700">Review Extra Backup Items</span>
                  )}
                </div>
              </div>

              {/* Notes / Remarks */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Technician Installation Notes / Handover Remarks <span className="text-gray-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  disabled={readOnly}
                  rows={2}
                  value={generalRemarks}
                  onChange={(e) => setGeneralRemarks(e.target.value)}
                  placeholder="Optional notes regarding site conditions, client handover, or physical installation details..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-purple-500 outline-none disabled:bg-gray-100"
                />
              </div>

              {/* Stock Protection Notice */}
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 text-[11px] text-gray-500">
                <ShieldCheck className="w-4 h-4 text-purple-600 shrink-0" />
                <span>
                  <strong>Stock Protection:</strong> Submitting records technician declaration only. Returned products remain pending until physical verification by the Store Manager.
                </span>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  {readOnly ? 'Close' : 'Cancel'}
                </button>

                {!readOnly && (
                  <button
                    type="submit"
                    disabled={loading || !isFormBalanced}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Submit Completion Report</span>
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
