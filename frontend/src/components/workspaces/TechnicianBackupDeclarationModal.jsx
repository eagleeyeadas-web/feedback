import { useState, useEffect, useRef } from 'react';
import {
  X,
  Package,
  Plus,
  Trash2,
  Info,
  History,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Save,
  ShieldCheck,
  Search,
  ChevronDown,
} from 'lucide-react';
import { fetchBackupProducts, fetchBackupDeclaration, saveBackupDeclaration } from '../../lib/api';

/**
 * Searchable Dropdown filtered by Category
 */
function SearchableProductSelect({
  value,
  products = [],
  onSelect,
  placeholder = 'Search & select product...',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  // Close when clicking outside or pressing Escape
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
    (p) => (p.item_name || '').toLowerCase() === (value || '').toLowerCase() || p.id === value
  );

  const filtered = products.filter((p) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (p.item_name && p.item_name.toLowerCase().includes(term)) ||
      (p.sku && p.sku.toLowerCase().includes(term))
    );
  });

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setSearchTerm('');
        }}
        className={`w-full text-left text-xs p-2 rounded-lg border flex items-center justify-between transition-all cursor-pointer bg-white ${
          isOpen ? 'border-purple-500 ring-2 ring-purple-100 shadow-sm' : 'border-gray-200 hover:border-gray-300'
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
                No matching products found
              </div>
            ) : (
              filtered.map((p) => {
                const isSelected = selectedProduct?.id === p.id || selectedProduct?.item_name === p.item_name;
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
                        In Store: <strong className="text-gray-700 font-mono">{p.available_stock} {p.unit}</strong>
                      </span>
                    </div>
                    <span className="shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 bg-gray-100 text-gray-700 rounded border border-gray-200">
                      {p.unit}
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

export default function TechnicianBackupDeclarationModal({
  isOpen,
  job,
  token,
  onClose,
  onSaved,
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [availableProducts, setAvailableProducts] = useState([]);
  const [hasBackupItems, setHasBackupItems] = useState(false);
  const [noItemsReason, setNoItemsReason] = useState('');
  const [items, setItems] = useState([]);
  const [declarationStatus, setDeclarationStatus] = useState('NOT_RECORDED');
  const [declarationTimestamp, setDeclarationTimestamp] = useState(null);
  const [history, setHistory] = useState([]);
  const [salesExpected, setSalesExpected] = useState(false);

  useEffect(() => {
    if (!isOpen || !job?.id) return;
    let isMounted = true;

    async function load() {
      setLoading(true);
      setError('');
      setSuccessMsg('');
      try {
        const [products, decl] = await Promise.all([
          fetchBackupProducts(token).catch(() => []),
          fetchBackupDeclaration(token, job.id).catch(() => null),
        ]);

        if (!isMounted) return;

        setAvailableProducts(products);

        const salesExpects = Boolean(job.carry_extra_backup_items ?? job.extra_devices ?? decl?.sales_expected);
        setSalesExpected(salesExpects);

        if (decl && decl.status && decl.status !== 'NOT_RECORDED') {
          setHasBackupItems(Boolean(decl.has_backup_items));
          setNoItemsReason(decl.no_items_reason || '');
          setDeclarationStatus(decl.status);
          setDeclarationTimestamp(decl.declaration_timestamp || decl.updated_at);
          setHistory(Array.isArray(decl.history) ? decl.history : []);

          if (Array.isArray(decl.items) && decl.items.length > 0) {
            setItems(
              decl.items.map((it, idx) => {
                const matched = products.find(
                  (p) =>
                    p.id === it.material_id ||
                    p.id === it.item_id ||
                    (p.item_name || '').toLowerCase() === (it.item_name || '').toLowerCase()
                );
                const isDeviceComp =
                  it.category === 'Device Component' ||
                  matched?.category === 'Device Component' ||
                  matched?.category_group === 'A' ||
                  matched?.category?.includes('Component') ||
                  matched?.category?.includes('Device') ||
                  (it.item_name || '').toLowerCase().includes('camera') ||
                  (it.item_name || '').toLowerCase().includes('display') ||
                  (it.item_name || '').toLowerCase().includes('mdvr');

                return {
                  id: it.id || `item-${idx}-${Date.now()}`,
                  category: isDeviceComp ? 'Device Component' : 'Installation Material',
                  item_name: it.item_name || '',
                  quantity: Number(it.quantity) || 1,
                  unit: it.unit || matched?.unit || 'Nos.',
                  sku: it.item_sku || it.sku || matched?.sku || '',
                  material_id: it.material_id || it.item_id || matched?.id || null,
                };
              })
            );
          } else {
            setItems([]);
          }
        } else {
          // Defaults if not yet recorded
          setHasBackupItems(salesExpects);
          setNoItemsReason('');
          setDeclarationStatus('NOT_RECORDED');
          setDeclarationTimestamp(null);
          setHistory([]);
          if (salesExpects) {
            const firstComp = products.find(
              (p) => p.category === 'Device Component' || p.category_group === 'A' || (p.item_name || '').toLowerCase().includes('camera')
            ) || products[0];

            setItems([
              {
                id: `item-init-${Date.now()}`,
                category: 'Device Component',
                item_name: firstComp ? firstComp.item_name : 'Camera',
                quantity: 1,
                unit: firstComp ? firstComp.unit : 'Nos.',
                sku: firstComp ? firstComp.sku : '',
                material_id: firstComp ? firstComp.id : null,
              },
            ]);
          } else {
            setItems([]);
          }
        }
      } catch (err) {
        if (isMounted) setError(err.message || 'Failed to load backup declaration details');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [isOpen, job, token]);

  if (!isOpen || !job) return null;

  const handleAddItemRow = (initialCat = 'Device Component') => {
    const prodsForCat = availableProducts.filter((p) =>
      initialCat === 'Device Component'
        ? p.category === 'Device Component' || p.category_group === 'A' || p.category?.includes('Component') || p.category?.includes('Device')
        : p.category === 'Installation Material' || p.category_group === 'B' || p.category?.includes('Material')
    );
    const firstProd = prodsForCat[0] || availableProducts[0];
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        category: initialCat,
        item_name: firstProd ? firstProd.item_name : '',
        quantity: 1,
        unit: firstProd ? firstProd.unit : 'Nos.',
        sku: firstProd ? firstProd.sku : '',
        material_id: firstProd ? firstProd.id : null,
      },
    ]);
  };

  const handleRemoveItemRow = (id) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleCategoryChange = (rowId, newCategory) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        const prodsForCat = availableProducts.filter((p) =>
          newCategory === 'Device Component'
            ? p.category === 'Device Component' || p.category_group === 'A' || p.category?.includes('Component') || p.category?.includes('Device')
            : p.category === 'Installation Material' || p.category_group === 'B' || p.category?.includes('Material')
        );
        const match = prodsForCat.find(
          (p) => p.item_name.toLowerCase() === (it.item_name || '').toLowerCase()
        );
        if (match) {
          return {
            ...it,
            category: newCategory,
            unit: match.unit || 'Nos.',
            sku: match.sku || it.sku,
            material_id: match.id || it.material_id,
          };
        }
        const firstProd = prodsForCat[0];
        return {
          ...it,
          category: newCategory,
          item_name: firstProd ? firstProd.item_name : '',
          unit: firstProd ? firstProd.unit : 'Nos.',
          sku: firstProd ? firstProd.sku : '',
          material_id: firstProd ? firstProd.id : null,
        };
      })
    );
  };

  const handleProductSelect = (rowId, product) => {
    if (!product) return;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        const isDeviceComp =
          product.category === 'Device Component' ||
          product.category_group === 'A' ||
          product.category?.includes('Component') ||
          product.category?.includes('Device');
        return {
          ...it,
          category: isDeviceComp ? 'Device Component' : 'Installation Material',
          item_name: product.item_name,
          unit: product.unit || 'Nos.',
          sku: product.sku || '',
          material_id: product.id || null,
        };
      })
    );
  };

  const handleItemChange = (id, field, value) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        if (field === 'quantity') {
          return { ...it, quantity: value };
        }
        return { ...it, [field]: value };
      })
    );
  };

  const handleToggleHasItems = (isYes) => {
    setHasBackupItems(isYes);
    setError('');
    if (isYes && items.length === 0) {
      handleAddItemRow('Device Component');
    }
  };

  const validate = () => {
    if (salesExpected && !hasBackupItems) {
      if (!noItemsReason || !noItemsReason.trim()) {
        return 'Sales indicated extra backup items are expected. Please specify why no extra backup items were carried to the site.';
      }
    }

    if (hasBackupItems) {
      if (!items || items.length === 0) {
        return 'Please add at least one extra backup item.';
      }
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.item_name || !it.item_name.trim()) {
          return `Row #${i + 1}: Please select a product.`;
        }
        const q = Number(it.quantity);
        if (isNaN(q) || q <= 0) {
          return `Row #${i + 1} (${it.item_name}): Quantity must be a positive number greater than 0.`;
        }
      }
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const valErr = validate();
    if (valErr) {
      setError(valErr);
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      // Merge duplicate rows for the same product safely
      const itemMap = new Map();
      if (hasBackupItems) {
        items.forEach((it) => {
          const key = it.item_name.trim().toLowerCase();
          const q = Number(it.quantity);
          if (!key || isNaN(q) || q <= 0) return;
          if (itemMap.has(key)) {
            const existing = itemMap.get(key);
            existing.quantity += q;
          } else {
            itemMap.set(key, {
              item_name: it.item_name.trim(),
              quantity: q,
              unit: it.unit || 'Nos.',
              category: it.category || 'Device Component',
              item_sku: it.sku || null,
              item_id: it.material_id || null,
            });
          }
        });
      }

      const payload = {
        has_backup_items: hasBackupItems,
        no_items_reason: hasBackupItems ? null : noItemsReason.trim(),
        items: hasBackupItems ? Array.from(itemMap.values()) : [],
      };

      const res = await saveBackupDeclaration(token, job.id, payload);
      setSuccessMsg('Pre-installation extra items declaration saved successfully!');
      setTimeout(() => {
        if (onSaved) onSaved(res.declaration);
        onClose();
      }, 750);
    } catch (err) {
      setError(err.message || 'Failed to save extra items declaration');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 1. Modal Header (Clean & Compact) */}
        <div className="bg-gradient-to-r from-purple-900 via-indigo-950 to-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-200">
              <Package size={17} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight">Pre-Installation: Extra Items</h3>
                <span className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-800 text-purple-200 border border-purple-600/40">
                  {declarationStatus === 'CORRECTED' ? 'Corrected' : declarationStatus === 'DECLARED' ? 'Declared' : 'Not Recorded'}
                </span>
              </div>
              <p className="text-[11px] text-purple-200/80 mt-0.5">
                Checklist #{job.checklist_number} • Client: {job.client_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-purple-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <X size={17} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 max-h-[78vh] overflow-y-auto">
          {/* Alerts */}
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
              <AlertTriangle size={15} className="text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* 2. Sales Checklist Expectation (Compact Card) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-500">Sales Team Expectation:</span>
              <span className="font-bold text-gray-900">Technician carrying extra backup items?</span>
            </div>
            <span
              className={`px-2.5 py-0.5 rounded text-[11px] font-extrabold tracking-wide uppercase ${
                salesExpected
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : 'bg-slate-200 text-slate-700 border border-slate-300'
              }`}
            >
              {salesExpected ? 'YES' : 'NO'}
            </span>
          </div>

          {/* 3. Mandatory Rule (Compact Message) */}
          <div className="p-2.5 bg-purple-50/80 border border-purple-200/80 rounded-xl text-[11px] text-purple-950 flex items-start gap-2">
            <Info size={15} className="text-purple-700 shrink-0 mt-0.5" />
            <p className="leading-snug">
              Extra backup items are individual components and installation materials carried for site contingencies. They are not complete device sets and do not change customer device quantities or the Sales preliminary BOM.
            </p>
          </div>

          {loading ? (
            <div className="py-10 text-center text-gray-400">
              <Loader2 className="w-7 h-7 animate-spin mx-auto mb-2 text-purple-600" />
              <p className="text-xs">Loading backup products catalogue...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 4. Technician Declaration */}
              <div className="p-3.5 rounded-xl border border-gray-200 bg-white space-y-2.5">
                <label className="block text-xs font-bold text-gray-900">
                  Are you carrying extra backup items for this job? <span className="text-rose-500">*</span>
                </label>
                <div className="flex flex-wrap items-center gap-5">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="techHasBackupItems"
                      checked={hasBackupItems}
                      onChange={() => handleToggleHasItems(true)}
                      className="w-4 h-4 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-xs font-bold text-purple-900">
                      Yes, carrying extra backup items
                    </span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="techHasBackupItems"
                      checked={!hasBackupItems}
                      onChange={() => handleToggleHasItems(false)}
                      className="w-4 h-4 text-gray-600 focus:ring-gray-500"
                    />
                    <span className="text-xs font-semibold text-gray-700">
                      No extra backup items carried
                    </span>
                  </label>
                </div>

                {/* If Sales indicated YES but Tech selects NO: require reason */}
                {salesExpected && !hasBackupItems && (
                  <div className="pt-2">
                    <label className="block text-xs font-bold text-rose-800 mb-1">
                      Reason why no backup items were carried <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      value={noItemsReason}
                      onChange={(e) => setNoItemsReason(e.target.value)}
                      placeholder="Explain why backup hardware was not carried (e.g., standard depot fleet, verified working stock on site)..."
                      rows={2}
                      className="w-full text-xs p-2.5 border border-rose-300 rounded-xl focus:outline-none focus:border-rose-500 font-medium bg-rose-50/20"
                    />
                  </div>
                )}
              </div>

              {/* 5. Extra-Item Entry Section */}
              {hasBackupItems && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                        Extra Items Declaration
                      </h4>
                      <p className="text-[11px] text-gray-500">
                        Record each individual component or installation material and its quantity.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddItemRow('Device Component')}
                      className="px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                    >
                      <Plus size={14} /> Add Product
                    </button>
                  </div>

                  {/* Desktop Table View */}
                  <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-gray-200 text-gray-600 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-2.5 px-3 w-10 text-center">#</th>
                          <th className="py-2.5 px-3 w-44">Category</th>
                          <th className="py-2.5 px-3">Product</th>
                          <th className="py-2.5 px-3 w-28 text-center">Quantity</th>
                          <th className="py-2.5 px-3 w-28 text-center">Unit</th>
                          <th className="py-2.5 px-3 text-right w-14">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {items.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-6 text-center text-gray-400 italic">
                              No loose items added yet. Click "+ Add Product" to add.
                            </td>
                          </tr>
                        ) : (
                          items.map((it, idx) => {
                            const prodsForCat = availableProducts.filter((p) =>
                              it.category === 'Device Component'
                                ? p.category === 'Device Component' || p.category_group === 'A' || p.category?.includes('Component') || p.category?.includes('Device')
                                : p.category === 'Installation Material' || p.category_group === 'B' || p.category?.includes('Material')
                            );

                            return (
                              <tr key={it.id} className="hover:bg-slate-50/70 transition-colors">
                                <td className="py-2.5 px-3 font-mono font-bold text-gray-400 text-center">
                                  {idx + 1}
                                </td>
                                <td className="py-2.5 px-3">
                                  <select
                                    value={it.category}
                                    onChange={(e) => handleCategoryChange(it.id, e.target.value)}
                                    className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-semibold bg-white text-gray-800 cursor-pointer"
                                  >
                                    <option value="Device Component">Device Component</option>
                                    <option value="Installation Material">Installation Material</option>
                                  </select>
                                </td>
                                <td className="py-2.5 px-3 min-w-[220px]">
                                  <SearchableProductSelect
                                    value={it.item_name}
                                    products={prodsForCat}
                                    onSelect={(prod) => handleProductSelect(it.id, prod)}
                                    placeholder="Search & select product..."
                                  />
                                </td>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="number"
                                    min="0.1"
                                    step="any"
                                    value={it.quantity}
                                    onChange={(e) => handleItemChange(it.id, 'quantity', e.target.value)}
                                    placeholder="1"
                                    className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-bold font-mono text-center text-gray-900 bg-white"
                                    required
                                  />
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="flex items-center justify-center px-2 py-2 bg-slate-100/90 border border-slate-200 rounded-lg text-slate-800 font-bold font-mono text-xs select-none">
                                    <span>{it.unit || 'Nos.'}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveItemRow(it.id)}
                                    className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                                    title="Remove item"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Stacked Cards View */}
                  <div className="md:hidden space-y-3">
                    {items.length === 0 ? (
                      <div className="p-4 border border-dashed border-gray-300 rounded-xl text-center text-gray-400 text-xs italic">
                        No loose items added yet. Click "+ Add Product" to add.
                      </div>
                    ) : (
                      items.map((it, idx) => {
                        const prodsForCat = availableProducts.filter((p) =>
                          it.category === 'Device Component'
                            ? p.category === 'Device Component' || p.category_group === 'A' || p.category?.includes('Component') || p.category?.includes('Device')
                            : p.category === 'Installation Material' || p.category_group === 'B' || p.category?.includes('Material')
                        );

                        return (
                          <div key={it.id} className="p-3.5 bg-white border border-gray-200 rounded-xl space-y-2.5 shadow-2xs">
                            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                              <span className="font-bold text-xs text-purple-900 font-mono">
                                Item #{idx + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveItemRow(it.id)}
                                className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1 rounded-lg transition-colors cursor-pointer text-xs flex items-center gap-1 font-semibold"
                              >
                                <Trash2 size={14} /> Remove
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div>
                                <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                                  Category
                                </label>
                                <select
                                  value={it.category}
                                  onChange={(e) => handleCategoryChange(it.id, e.target.value)}
                                  className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-semibold bg-white text-gray-800"
                                >
                                  <option value="Device Component">Device Component</option>
                                  <option value="Installation Material">Installation Material</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                                  Product
                                </label>
                                <SearchableProductSelect
                                  value={it.item_name}
                                  products={prodsForCat}
                                  onSelect={(prod) => handleProductSelect(it.id, prod)}
                                  placeholder="Search & select product..."
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                                    Quantity
                                  </label>
                                  <input
                                    type="number"
                                    min="0.1"
                                    step="any"
                                    value={it.quantity}
                                    onChange={(e) => handleItemChange(it.id, 'quantity', e.target.value)}
                                    placeholder="1"
                                    className="w-full text-xs p-2 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-bold font-mono text-center text-gray-900 bg-white"
                                    required
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                                    Unit
                                  </label>
                                  <div className="w-full text-xs p-2 bg-slate-100 border border-slate-200 rounded-lg font-bold font-mono text-center text-slate-800">
                                    {it.unit || 'Nos.'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* 7. Compact Declaration Summary */}
                  {items.length > 0 && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center justify-between font-bold text-gray-700">
                        <span className="flex items-center gap-1.5 uppercase text-[10px] tracking-wider text-purple-950 font-bold">
                          <Package size={13} className="text-purple-600" /> Declaration Summary
                        </span>
                        <span className="text-[11px] font-mono font-bold text-purple-800 bg-purple-100/70 px-2 py-0.5 rounded border border-purple-200">
                          {items.filter((it) => it.item_name && Number(it.quantity) > 0).length} declared product line(s)
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {items
                          .filter((it) => it.item_name && Number(it.quantity) > 0)
                          .map((it, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-gray-800 font-medium text-[11px] shadow-2xs"
                            >
                              <span className="text-gray-500 text-[10px]">[{it.category === 'Device Component' ? 'Device' : 'Mat'}]:</span>
                              <span className="font-semibold text-gray-900">{it.item_name}:</span>
                              <strong className="text-purple-800 font-mono">{it.quantity} {it.unit || 'Nos.'}</strong>
                            </span>
                          ))}
                      </div>
                      <p className="text-[10px] text-gray-400 italic">
                        * Note: This summary represents the technician's declaration. Warehouse stock is deducted only when authorized by Store Manager during issuance.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* History Preview */}
              {history.length > 0 && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-700 uppercase tracking-wider">
                    <History size={12} className="text-purple-600" /> Revision History ({history.length})
                  </div>
                  <div className="space-y-1 max-h-20 overflow-y-auto">
                    {history.map((h, i) => (
                      <div key={i} className="text-[10px] text-gray-600 flex items-center justify-between bg-white px-2 py-0.5 rounded border border-gray-100">
                        <span>Modified by {h.modified_by} ({h.previous_items_count} items)</span>
                        <span className="font-mono text-gray-400">{new Date(h.modified_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamp footer indicator */}
              {declarationTimestamp && (
                <div className="text-[10px] text-gray-400 flex items-center gap-1 font-mono">
                  <ShieldCheck size={12} className="text-emerald-500" /> Last recorded: {new Date(declarationTimestamp).toLocaleString()}
                </div>
              )}

              {/* 8. Footer Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  <span>{submitting ? 'Saving...' : 'Save Declaration'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
