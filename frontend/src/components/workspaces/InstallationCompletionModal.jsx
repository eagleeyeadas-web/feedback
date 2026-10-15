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
 * Extracts channel count from device type string (e.g. "4 Channel Live" -> 4)
 */
function getChannelCount(deviceType) {
  if (!deviceType || typeof deviceType !== 'string') return 1;
  const match = deviceType.match(/(\d+)\s*channel/i);
  return match ? parseInt(match[1], 10) : 1;
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
  const [deviceItems, setDeviceItems] = useState([]);
  const [materialItems, setMaterialItems] = useState([]);
  const [materialsCollapsed, setMaterialsCollapsed] = useState(false);
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

        // 2. If in readOnly mode, fetch existing completion report and populate rows
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

              if (Array.isArray(report.items) && report.items.length > 0) {
                const devRows = report.items.map((it, idx) => {
                  const carried = Number(it.quantity_carried ?? it.quantity_issued) || 0;
                  const reqInst = Number(it.quantity_installed_required) || 0;
                  const extInst = Number(it.quantity_installed_extra) || 0;
                  const totalInst = reqInst + extInst > 0 ? (reqInst + extInst) : (Number(it.quantity_installed) || 0);
                  const ret = Number(it.quantity_to_return ?? it.quantity_returned) || 0;
                  const dam = Number(it.quantity_damaged) || 0;
                  const mis = Number(it.quantity_missing) || 0;
                  const matched = products.find(
                    (p) => (p.item_name || '').toLowerCase() === (it.device_type || '').toLowerCase()
                  );

                  return {
                    id: `rep-dev-${idx}`,
                    product_id: matched?.id || it.product_id || null,
                    product_name: it.device_type,
                    sku: matched?.sku || '',
                    category: 'Device Component',
                    unit: it.unit || matched?.unit || 'Nos.',
                    standard_quantity: it.standard_quantity ?? it.required_quantity ?? Math.max(0, carried - extInst),
                    extra_quantity: it.extra_quantity ?? extInst,
                    quantity_issued: carried,
                    quantity_installed: totalInst,
                    quantity_returned: ret,
                    quantity_damaged: dam,
                    quantity_missing: mis,
                    discrepancy_reason: it.discrepancy_reason || '',
                    is_custom_added: false,
                  };
                });
                setDeviceItems(devRows);
              }

              if (Array.isArray(report.material_items) && report.material_items.length > 0) {
                const matRows = report.material_items.map((m, idx) => {
                  const issued = Number(m.quantity_issued) || 0;
                  const used = Number(m.quantity_used) || 0;
                  const ret = Number(m.quantity_returned) || 0;
                  const dam = Number(m.quantity_damaged) || 0;
                  const mis = Number(m.quantity_missing) || 0;
                  const matched = products.find(
                    (p) => (p.item_name || '').toLowerCase() === (m.material_name || '').toLowerCase()
                  );

                  return {
                    id: `rep-mat-${idx}`,
                    product_id: matched?.id || m.material_id || null,
                    product_name: m.material_name,
                    sku: matched?.sku || '',
                    category: 'Installation Material',
                    unit: m.unit || matched?.unit || 'Nos.',
                    standard_quantity: m.standard_quantity ?? issued,
                    extra_quantity: m.extra_quantity ?? 0,
                    quantity_issued: issued,
                    quantity_installed: used,
                    quantity_returned: ret,
                    quantity_damaged: dam,
                    quantity_missing: mis,
                    discrepancy_reason: m.remarks || '',
                    is_custom_added: false,
                  };
                });
                setMaterialItems(matRows);
              }

              setFetchingData(false);
              return;
            }
          } catch (e) {
            console.warn('Failed to load read-only completion report:', e.message);
          }
        }

        // 3. For new post-installation entry: consolidate standard issued items + extra backup items
        // Build map of standard items issued for the job
        const standardItemMap = new Map();

        // 3A. Calculate standard device components from job specification
        const configs = Array.isArray(checklist.device_configurations) && checklist.device_configurations.length > 0
          ? checklist.device_configurations
          : (checklist.device_type ? [{ device_type: checklist.device_type, number_of_devices: checklist.number_of_devices || 1 }] : []);

        let totalStandardCameras = 0;
        let totalLiveDisplays = 0;
        let totalRecordingDisplays = 0;

        configs.forEach((cfg) => {
          const type = cfg.device_type || '';
          const count = Number(cfg.number_of_devices ?? cfg.quantity_carried) || 1;
          const channels = getChannelCount(type);
          totalStandardCameras += channels * count;

          if (type.toLowerCase().includes('recording')) {
            totalRecordingDisplays += count;
          } else {
            totalLiveDisplays += count;
          }
        });

        if (totalStandardCameras > 0) {
          standardItemMap.set('camera', {
            product_name: 'Camera',
            category: 'Device Component',
            unit: 'Nos.',
            standard_quantity: totalStandardCameras,
          });
        }
        if (totalLiveDisplays > 0) {
          standardItemMap.set('live display', {
            product_name: 'Live Display',
            category: 'Device Component',
            unit: 'Nos.',
            standard_quantity: totalLiveDisplays,
          });
        }
        if (totalRecordingDisplays > 0) {
          standardItemMap.set('recording display', {
            product_name: 'Recording Display',
            category: 'Device Component',
            unit: 'Nos.',
            standard_quantity: totalRecordingDisplays,
          });
        }

        // 3B. Standard fitting materials from checklist preliminary BOM snapshot
        const prelimMaterials = checklist.bom_snapshot?.items || [];
        prelimMaterials.forEach((m) => {
          const name = (m.material_name || '').trim();
          if (!name) return;
          const qty = Number(m.total_quantity !== undefined ? m.total_quantity : m.quantity) || 0;
          const key = name.toLowerCase();

          if (standardItemMap.has(key)) {
            const existing = standardItemMap.get(key);
            existing.standard_quantity += qty;
          } else {
            standardItemMap.set(key, {
              product_name: name,
              material_id: m.material_id || null,
              category: isDeviceComponent(name) ? 'Device Component' : 'Installation Material',
              unit: m.unit || 'Nos.',
              standard_quantity: qty,
            });
          }
        });

        // 3C. Extra loose backup items from pre-installation declaration
        const backupItemMap = new Map();
        if (backupDecl && backupDecl.has_backup_items && Array.isArray(backupDecl.items)) {
          backupDecl.items.forEach((b) => {
            const name = (b.item_name || '').trim();
            if (!name) return;
            const qty = Number(b.quantity) || 0;
            const key = name.toLowerCase();
            backupItemMap.set(key, {
              product_name: name,
              material_id: b.material_id || b.item_id || null,
              unit: b.unit || 'Nos.',
              extra_quantity: qty,
              category: isDeviceComponent(name) ? 'Device Component' : 'Installation Material',
            });
          });
        }

        // 3D. Consolidate into unified loose product rows (distinguishing standard issued vs extra backup)
        const allKeys = new Set([...standardItemMap.keys(), ...backupItemMap.keys()]);
        const initialDevRows = [];
        const initialMatRows = [];

        let rowIdCounter = 1;
        allKeys.forEach((k) => {
          const std = standardItemMap.get(k);
          const ext = backupItemMap.get(k);

          const productName = std?.product_name || ext?.product_name;
          const matchedProd = products.find(
            (p) => (p.item_name || '').toLowerCase() === productName.toLowerCase()
          );

          const stdQty = std ? std.standard_quantity : 0;
          const extQty = ext ? ext.extra_quantity : 0;
          const totalIssued = stdQty + extQty;

          // By default: standard quantity assumed installed/used, extra backup quantity assumed returned
          const defaultInstalled = stdQty;
          const defaultReturned = extQty;

          const isDev = (std?.category === 'Device Component') || (ext?.category === 'Device Component') || isDeviceComponent(productName);
          const rowObj = {
            id: `row-${Date.now()}-${rowIdCounter++}`,
            product_id: matchedProd?.id || std?.material_id || ext?.material_id || null,
            product_name: productName,
            sku: matchedProd?.sku || '',
            category: isDev ? 'Device Component' : 'Installation Material',
            unit: matchedProd?.unit || std?.unit || ext?.unit || 'Nos.',
            standard_quantity: stdQty,
            extra_quantity: extQty,
            quantity_issued: totalIssued,
            quantity_installed: defaultInstalled,
            quantity_returned: defaultReturned,
            quantity_damaged: 0,
            quantity_missing: 0,
            discrepancy_reason: '',
            is_custom_added: false,
          };

          if (isDev) {
            initialDevRows.push(rowObj);
          } else {
            initialMatRows.push(rowObj);
          }
        });

        // If no device components were generated, provide standard defaults
        if (initialDevRows.length === 0) {
          const defaultDev = products.find((p) => p.item_name === 'Camera') || products[0];
          initialDevRows.push({
            id: `row-init-dev`,
            product_id: defaultDev?.id || null,
            product_name: defaultDev ? defaultDev.item_name : 'Camera',
            sku: defaultDev?.sku || '',
            category: 'Device Component',
            unit: defaultDev?.unit || 'Nos.',
            standard_quantity: 0,
            extra_quantity: 0,
            quantity_issued: 0,
            quantity_installed: 0,
            quantity_returned: 0,
            quantity_damaged: 0,
            quantity_missing: 0,
            discrepancy_reason: '',
            is_custom_added: true,
          });
        }

        setDeviceItems(initialDevRows);
        setMaterialItems(initialMatRows);
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

  // Update item field in deviceItems or materialItems
  const handleItemFieldChange = (listType, id, field, value) => {
    const setter = listType === 'device' ? setDeviceItems : setMaterialItems;
    setter((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, [field]: value };
        return updated;
      })
    );
  };

  // When technician picks a different product from dropdown
  const handleProductSelect = (listType, id, product) => {
    const setter = listType === 'device' ? setDeviceItems : setMaterialItems;
    setter((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        return {
          ...row,
          product_id: product.id,
          product_name: product.item_name,
          sku: product.sku || '',
          unit: product.unit || 'Nos.',
          category: product.category || (listType === 'device' ? 'Device Component' : 'Installation Material'),
        };
      })
    );
  };

  // Add a new loose product row
  const handleAddRow = (listType) => {
    const prodsForCategory = availableProducts.filter((p) =>
      listType === 'device'
        ? p.category === 'Device Component' || isDeviceComponent(p.item_name)
        : p.category === 'Installation Material' || !isDeviceComponent(p.item_name)
    );
    const defaultProduct = prodsForCategory[0] || availableProducts[0];

    const newRow = {
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      product_id: defaultProduct ? defaultProduct.id : null,
      product_name: defaultProduct ? defaultProduct.item_name : '',
      sku: defaultProduct ? defaultProduct.sku : '',
      category: listType === 'device' ? 'Device Component' : 'Installation Material',
      unit: defaultProduct ? defaultProduct.unit : 'Nos.',
      standard_quantity: 0,
      extra_quantity: 0,
      quantity_issued: 0,
      quantity_installed: 0,
      quantity_returned: 0,
      quantity_damaged: 0,
      quantity_missing: 0,
      discrepancy_reason: '',
      is_custom_added: true,
    };

    if (listType === 'device') {
      setDeviceItems((prev) => [...prev, newRow]);
    } else {
      setMaterialItems((prev) => [...prev, newRow]);
      setMaterialsCollapsed(false);
    }
  };

  // Remove row
  const handleRemoveRow = (listType, id) => {
    const setter = listType === 'device' ? setDeviceItems : setMaterialItems;
    setter((prev) => prev.filter((r) => r.id !== id));
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

  // Sync Extra Component Usage directly into Device Items
  const handleSyncExtraToReconciliation = () => {
    const extraCompTotals = new Map();
    extraInstallations.forEach((inst) => {
      (inst.components_used || []).forEach((c) => {
        const key = (c.component_name || '').toLowerCase();
        const current = extraCompTotals.get(key) || 0;
        extraCompTotals.set(key, current + (Number(c.quantity) || 0));
      });
    });

    setDeviceItems((prev) =>
      prev.map((row) => {
        const key = (row.product_name || '').toLowerCase();
        let extraUsed = 0;
        if (extraCompTotals.has(key)) {
          extraUsed = extraCompTotals.get(key);
        } else if (key.includes('camera') && extraCompTotals.has('camera')) {
          extraUsed = extraCompTotals.get('camera');
        } else if (key.includes('live') && extraCompTotals.has('live display')) {
          extraUsed = extraCompTotals.get('live display');
        } else if (key.includes('recording') && extraCompTotals.has('recording display')) {
          extraUsed = extraCompTotals.get('recording display');
        }

        const stdQty = Number(row.standard_quantity) || 0;
        const newInstalled = stdQty + extraUsed;
        const issued = Number(row.quantity_issued) || 0;
        const dam = Number(row.quantity_damaged) || 0;
        const mis = Number(row.quantity_missing) || 0;
        const newReturned = Math.max(0, issued - newInstalled - dam - mis);

        return {
          ...row,
          quantity_installed: newInstalled,
          quantity_returned: newReturned,
        };
      })
    );
  };

  // Row validation calculation
  const getRowStats = (row) => {
    const issued = Number(row.quantity_issued) || 0;
    const installed = Number(row.quantity_installed) || 0;
    const returned = Number(row.quantity_returned) || 0;
    const damaged = Number(row.quantity_damaged) || 0;
    const missing = Number(row.quantity_missing) || 0;

    const hasNegative = installed < 0 || returned < 0 || damaged < 0 || missing < 0;
    const totalAccounted = installed + returned + damaged + missing;
    const isBalanced = !hasNegative && totalAccounted === issued;
    const isUnissued = issued === 0;

    return {
      issued,
      installed,
      returned,
      damaged,
      missing,
      hasNegative,
      totalAccounted,
      isBalanced,
      isUnissued,
    };
  };

  // Overall form validation
  const validateForm = () => {
    const allRows = [...deviceItems, ...materialItems];
    if (allRows.length === 0) {
      return 'Please enter at least one product row.';
    }

    // Validate Extra Device Installations if any added
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

    for (const row of allRows) {
      const name = row.product_name || 'Selected product';
      const stats = getRowStats(row);

      if (!row.product_name || !row.product_name.trim()) {
        return 'All product rows must have a product selected.';
      }

      if (stats.hasNegative) {
        return `Quantities for "${name}" cannot be negative numbers.`;
      }

      if (stats.isUnissued && stats.installed > 0) {
        return `Cannot report installation of unissued product "${name}" (Quantity issued is 0).`;
      }

      if (!stats.isBalanced) {
        return `Reconciliation mismatch for "${name}": Quantity issued (${stats.issued}) must equal Installed/Used (${stats.installed}) + Returned Unused (${stats.returned}) + Damaged (${stats.damaged}) + Missing (${stats.missing}). Currently totals ${stats.totalAccounted}.`;
      }

      if ((stats.damaged > 0 || stats.missing > 0) && (!row.discrepancy_reason || !row.discrepancy_reason.trim())) {
        return `Discrepancy explanation remark is required for "${name}" because damaged (${stats.damaged}) or missing (${stats.missing}) items were recorded.`;
      }
    }

    return null;
  };

  const isFormBalanced = [...deviceItems, ...materialItems].every((r) => getRowStats(r).isBalanced);

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
        items: deviceItems.map((d) => {
          const stats = getRowStats(d);
          const stdQty = Number(d.standard_quantity) || 0;
          const reqInst = Math.min(stats.installed, stdQty);
          const extInst = Math.max(0, stats.installed - stdQty);

          return {
            product_id: d.product_id,
            device_type: d.product_name,
            item_name: d.product_name,
            unit: d.unit || 'Nos.',
            category: d.category,
            standard_quantity: stdQty,
            extra_quantity: Number(d.extra_quantity) || 0,
            quantity_carried: stats.issued,
            quantity_installed_required: reqInst,
            quantity_installed_extra: extInst,
            quantity_installed: stats.installed,
            quantity_to_return: stats.returned,
            quantity_damaged: stats.damaged,
            quantity_missing: stats.missing,
            discrepancy_reason: d.discrepancy_reason ? d.discrepancy_reason.trim() : null,
          };
        }),
        material_items: materialItems.map((m) => {
          const stats = getRowStats(m);
          return {
            material_id: m.product_id,
            material_name: m.product_name,
            unit: m.unit || 'Nos.',
            standard_quantity: Number(m.standard_quantity) || 0,
            extra_quantity: Number(m.extra_quantity) || 0,
            quantity_issued: stats.issued,
            quantity_used: stats.installed,
            quantity_returned: stats.returned,
            quantity_damaged: stats.damaged,
            quantity_missing: stats.missing,
            remarks: m.discrepancy_reason ? m.discrepancy_reason.trim() : null,
          };
        }),
        backup_items: [...deviceItems, ...materialItems]
          .filter((it) => (Number(it.extra_quantity) || 0) > 0)
          .map((b) => {
            const stats = getRowStats(b);
            const stdQty = Number(b.standard_quantity) || 0;
            const extraUsed = Math.max(0, stats.installed - stdQty);
            return {
              item_name: b.product_name,
              unit: b.unit || 'Nos.',
              quantity_carried: Number(b.extra_quantity) || 0,
              quantity_used: extraUsed,
              quantity_returned: stats.returned,
              quantity_damaged: stats.damaged,
              quantity_missing: stats.missing,
              discrepancy_reason: b.discrepancy_reason ? b.discrepancy_reason.trim() : null,
            };
          }),
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

  // Render a product row (shared layout for devices and materials)
  const renderProductRow = (row, idx, listType) => {
    const stats = getRowStats(row);
    const prodsForCat = availableProducts.filter((p) =>
      listType === 'device'
        ? p.category === 'Device Component' || isDeviceComponent(p.item_name)
        : p.category === 'Installation Material' || !isDeviceComponent(p.item_name)
    );

    return (
      <div
        key={row.id}
        className={`p-3.5 rounded-xl border transition-all ${
          stats.isBalanced
            ? 'bg-white border-gray-200 shadow-2xs'
            : 'bg-rose-50/40 border-rose-200 shadow-xs'
        } space-y-2.5`}
      >
        {/* Row Header & Product Selection */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex-1 min-w-[200px]">
            {readOnly ? (
              <div className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-600"></span>
                <span>{row.product_name}</span>
                {row.sku && <span className="text-[10px] text-gray-400 font-mono">({row.sku})</span>}
              </div>
            ) : (
              <SearchableProductSelect
                value={row.product_name}
                products={prodsForCat}
                onSelect={(prod) => handleProductSelect(listType, row.id, prod)}
                placeholder="Search & select catalogue product..."
                disabled={readOnly}
              />
            )}
          </div>

          {/* Allocation & Reconciliation Status Badges */}
          <div className="flex items-center flex-wrap gap-2">
            <span
              className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200"
              title={`Standard: ${row.standard_quantity || 0}, Extra Backup: ${row.extra_quantity || 0}`}
            >
              Issued: <strong className="text-purple-700">{stats.issued}</strong> {row.unit}
              {(row.extra_quantity > 0 || row.standard_quantity > 0) && (
                <span className="text-[10px] text-gray-500 font-normal ml-1">
                  ({row.standard_quantity || 0} std + {row.extra_quantity || 0} extra)
                </span>
              )}
            </span>

            {stats.isBalanced ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                <CheckCircle2 size={12} className="text-emerald-600" /> Balanced
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                <AlertTriangle size={12} className="text-rose-600" />
                Unbalanced ({stats.totalAccounted}/{stats.issued})
              </span>
            )}

            {!readOnly && (
              <button
                type="button"
                onClick={() => handleRemoveRow(listType, row.id)}
                className="text-gray-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                title="Remove row"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Individual Quantities Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
          {/* Installed / Used */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
              Installed / Used <span className="text-rose-500">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="any"
              disabled={readOnly}
              value={row.quantity_installed}
              onChange={(e) => handleItemFieldChange(listType, row.id, 'quantity_installed', e.target.value)}
              className="w-full text-xs p-1.5 border border-gray-300 rounded-lg text-center font-mono font-bold text-emerald-700 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none disabled:bg-gray-100"
              required
            />
          </div>

          {/* Returned Unused */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
              Returned Unused <span className="text-rose-500">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="any"
              disabled={readOnly}
              value={row.quantity_returned}
              onChange={(e) => handleItemFieldChange(listType, row.id, 'quantity_returned', e.target.value)}
              className="w-full text-xs p-1.5 border border-blue-300 rounded-lg text-center font-mono font-bold text-blue-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100"
              required
            />
          </div>

          {/* Damaged */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
              Damaged
            </label>
            <input
              type="number"
              min="0"
              step="any"
              disabled={readOnly}
              value={row.quantity_damaged}
              onChange={(e) => handleItemFieldChange(listType, row.id, 'quantity_damaged', e.target.value)}
              className="w-full text-xs p-1.5 border border-amber-300 rounded-lg text-center font-mono font-bold text-amber-700 bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none disabled:bg-gray-100"
            />
          </div>

          {/* Missing */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
              Missing
            </label>
            <input
              type="number"
              min="0"
              step="any"
              disabled={readOnly}
              value={row.quantity_missing}
              onChange={(e) => handleItemFieldChange(listType, row.id, 'quantity_missing', e.target.value)}
              className="w-full text-xs p-1.5 border border-rose-300 rounded-lg text-center font-mono font-bold text-rose-700 bg-white focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none disabled:bg-gray-100"
            />
          </div>

          {/* Unit Badge (Read-only, obtained from product) */}
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
              Unit
            </label>
            <div className="w-full text-xs p-1.5 border border-gray-200 rounded-lg text-center font-mono font-semibold bg-gray-50 text-gray-700">
              {row.unit || 'Nos.'}
            </div>
          </div>
        </div>

        {/* Inline Discrepancy Remark if Damaged or Missing > 0 */}
        {(stats.damaged > 0 || stats.missing > 0) && (
          <div className="pt-1">
            <label className="block text-[11px] font-semibold text-rose-800 mb-1">
              Discrepancy Explanation for {row.product_name} <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              disabled={readOnly}
              value={row.discrepancy_reason || ''}
              onChange={(e) => handleItemFieldChange(listType, row.id, 'discrepancy_reason', e.target.value)}
              placeholder="Explain why units were damaged or missing on site..."
              className="w-full text-xs px-3 py-1.5 border border-rose-300 rounded-lg focus:ring-2 focus:ring-rose-500 outline-none bg-rose-50/50 text-gray-900"
              required
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl space-y-4 my-6 max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-purple-100 text-purple-800 rounded">
              {readOnly ? 'View Site Installation Report (Read-Only)' : 'Technical Site Completion & Returns Form'}
            </span>
            <h3 className="text-lg font-bold text-gray-900 mt-1 flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-purple-600" />
              {readOnly ? 'Site Work Completion & Returns Report' : 'Post-Installation Completion & Returns Form'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Read-Only Job Reference Summary */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase">Checklist No.</span>
              <span className="font-mono font-bold text-purple-700">{checklist.checklist_number}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase">Client Name</span>
              <span className="font-bold text-gray-900 truncate block">{checklist.client_name}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] font-semibold uppercase">Assigned Engineer</span>
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
              <strong>Individual Loose Product Tracking Rule:</strong> Every component (Camera, Live Display, Recording Display, Cables, Wire, Tape, etc.) is tracked individually. For every issued product: <strong>Quantity Issued = Installed/Used + Returned Unused + Damaged + Missing</strong>. All quantities must balance before submitting.
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
            <span className="text-xs font-medium">Loading catalogue and checklist components...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 text-xs">
            {/* ============================================================
                SECTION 1: EXTRA DEVICE INSTALLATIONS (ADDITIONAL CUSTOMERS)
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
                    {extraInstallations.length > 0 && (
                      <button
                        type="button"
                        onClick={handleSyncExtraToReconciliation}
                        className="px-2.5 py-1.5 text-xs font-semibold text-purple-700 bg-purple-100/80 hover:bg-purple-200 border border-purple-300 rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                        title="Auto-update component usage in the reconciliation table below"
                      >
                        <RefreshCw size={12} /> Auto-Sync to Usage Table
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
                {extraInstallations.length === 0 ? (
                  <div className="p-4 bg-white border border-dashed border-purple-200 rounded-xl text-center text-gray-500 text-xs">
                    <Package className="w-5 h-5 mx-auto mb-1 text-purple-400 opacity-60" />
                    <span className="font-semibold text-gray-700 block">No Extra Device Installations Recorded</span>
                    <span className="text-[11px] text-gray-400 block mt-0.5">
                      If extra loose stock was used to install cameras/displays for the same customer or another customer, click "+ Add Extra Installation".
                    </span>
                  </div>
                ) : (
                  extraInstallations.map((inst, idx) => (
                    <div key={inst.id} className="p-3.5 bg-white border border-purple-200 rounded-xl shadow-2xs space-y-3">
                      {/* Header */}
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

                      {/* Form Fields Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {/* Recipient Customer Type */}
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

                        {/* Recipient Customer Name */}
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

                        {/* Installation Date */}
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

                        {/* Mobile Number */}
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

                        {/* Installation Location */}
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

                        {/* Google Maps Link */}
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
                      </div>

                      {/* Device Configuration & Component Breakdown */}
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

                          <span className="text-[10px] text-gray-500 italic">
                            Calculated per configuration rules (2/4/6/8 Channel Live/Recording).
                          </span>
                        </div>

                        {/* Breakdown Component Badges / Editable Rows */}
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

                        {/* Optional Notes */}
                        <div className="pt-1">
                          <input
                            type="text"
                            disabled={readOnly}
                            value={inst.notes || ''}
                            onChange={(e) => handleExtraInstallationChange(inst.id, 'notes', e.target.value)}
                            placeholder="Optional notes for this extra installation (e.g. vehicle number, customer invoice ref)..."
                            className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ============================================================
                SECTION 2: POST-INSTALLATION RESULTS (DEVICE & COMPONENT TRACKING)
                ============================================================ */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-2">
                <div>
                  <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-purple-600" />
                    Device Components Reconciliation & Returns
                  </h4>
                  <p className="text-[11px] text-gray-500">
                    Individual tracking for Camera, Displays, Cables, Memory Cards, and configured device hardware.
                  </p>
                </div>

                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleAddRow('device')}
                    className="px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl flex items-center gap-1 transition-all cursor-pointer self-start sm:self-auto shadow-2xs"
                  >
                    <Plus size={14} /> Add Device Component
                  </button>
                )}
              </div>

              {deviceItems.length === 0 ? (
                <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-center text-gray-500 text-xs italic">
                  No device components recorded. Click "+ Add Device Component" to add one.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {deviceItems.map((row, idx) => renderProductRow(row, idx, 'device'))}
                </div>
              )}
            </div>

            {/* ============================================================
                SECTION 2: COLLAPSIBLE INSTALLATION MATERIALS SECTION
                ============================================================ */}
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
                      Fitting Materials Usage & Returns
                    </span>
                    <span className="text-[11px] text-gray-500">
                      Tape, cable ties, screws, wire, and other installation materials ({materialItems.length} items)
                    </span>
                  </div>
                  {materialsCollapsed ? (
                    <ChevronDown className="w-4 h-4 text-gray-400 ml-1" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-gray-400 ml-1" />
                  )}
                </button>

                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleAddRow('material')}
                    className="px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg flex items-center gap-1 shrink-0 ml-2 cursor-pointer shadow-2xs"
                  >
                    <Plus size={13} /> Add Material
                  </button>
                )}
              </div>

              {!materialsCollapsed && (
                <div className="p-3.5 space-y-2.5 bg-slate-50/50">
                  {materialItems.length === 0 ? (
                    <div className="p-4 bg-white border border-dashed border-gray-200 rounded-xl text-center text-gray-400 text-xs italic">
                      No fitting materials recorded for this job.
                      {!readOnly && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => handleAddRow('material')}
                            className="text-xs font-semibold text-blue-600 hover:underline"
                          >
                            + Add Material Item
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    materialItems.map((row, idx) => renderProductRow(row, idx, 'material'))
                  )}
                </div>
              )}
            </div>

            {/* ============================================================
                SECTION 3: RECONCILIATION SUMMARY BANNER
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
                  {isFormBalanced ? 'All Loose Products & Materials Reconciled' : 'Reconciliation Discrepancy Detected'}
                </span>
                <span className="text-[11px] opacity-80 block mt-0.5">
                  {isFormBalanced
                    ? 'All issued quantities equal Installed + Returned + Damaged + Missing. Ready for submission.'
                    : 'Every product row must balance (Issued = Installed + Returned + Damaged + Missing) before report submission.'}
                </span>
              </div>

              <div className="text-[11px] font-mono font-bold shrink-0">
                {isFormBalanced ? (
                  <span className="text-emerald-700">100% Balanced</span>
                ) : (
                  <span className="text-rose-700">Review Unbalanced Rows</span>
                )}
              </div>
            </div>

            {/* ============================================================
                SECTION 4: OPTIONAL INSTALLATION NOTES
                ============================================================ */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Technician Installation Notes / General Remarks <span className="text-gray-400 font-normal">(Optional)</span>
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
  );
}
