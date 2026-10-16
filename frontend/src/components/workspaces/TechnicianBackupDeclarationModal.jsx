import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  Check,
} from 'lucide-react';
import { fetchBackupProducts, fetchBackupDeclaration, saveBackupDeclaration } from '../../lib/api';

export const EXTRA_DEVICE_OPTIONS = [
  'Camera',
  'Live Display',
  'Recording Display',
];

/**
 * Portal-based Searchable Product Dropdown
 * Rendered directly to document.body to prevent parent container overflow clipping
 */
function SearchableProductSelect({
  value,
  products = [],
  onSelect,
  placeholder = 'Search & select product...',
  disabled = false,
  excludeItemNames = [],
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 320, showAbove: false, maxHeight: 260 });

  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  const optionsListRef = useRef(null);
  const optionRefs = useRef([]);

  // Compute position relative to viewport
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = 260;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const showAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    const width = Math.max(rect.width, 320);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12);
    }

    const top = showAbove
      ? Math.max(12, rect.top - dropdownHeight - 6)
      : rect.bottom + 6;

    setCoords({
      top,
      left,
      width,
      showAbove,
      maxHeight: Math.min(260, Math.max(140, showAbove ? spaceAbove - 24 : spaceBelow - 24)),
    });
  }, []);

  const openDropdown = () => {
    if (disabled) return;
    updatePosition();
    setIsOpen(true);
    setSearchTerm('');
    setHighlightedIndex(0);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setSearchTerm('');
  };

  // Keep position updated on scroll and window resize
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen, updatePosition]);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Outside click & Escape listener
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e) {
      if (triggerRef.current && triggerRef.current.contains(e.target)) {
        return;
      }
      if (menuRef.current && menuRef.current.contains(e.target)) {
        return;
      }
      closeDropdown();
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDropdown();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Current selected product from options list
  const selectedProduct = products.find(
    (p) =>
      (p.item_name || '').toLowerCase() === (value || '').toLowerCase() ||
      p.id === value ||
      (p.display_name || '').toLowerCase() === (value || '').toLowerCase()
  );

  // Search filter
  const filtered = products.filter((p) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (p.item_name && p.item_name.toLowerCase().includes(term)) ||
      (p.sku && p.sku.toLowerCase().includes(term)) ||
      (p.display_name && p.display_name.toLowerCase().includes(term)) ||
      (p.device_type && p.device_type.toLowerCase().includes(term))
    );
  });

  // Keep highlighted item in view
  useEffect(() => {
    if (isOpen && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  // Keyboard navigation within menu
  const handleMenuKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (filtered[highlightedIndex]) {
        handleSelectProduct(filtered[highlightedIndex]);
      }
    }
  };

  const handleSelectProduct = (p) => {
    onSelect(p);
    closeDropdown();
    triggerRef.current?.focus();
  };

  return (
    <div className="w-full relative">
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (isOpen) {
            closeDropdown();
          } else {
            openDropdown();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDropdown();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full text-left text-xs p-2.5 rounded-lg border flex items-center justify-between transition-all cursor-pointer bg-white ${
          isOpen
            ? 'border-purple-500 ring-2 ring-purple-100 shadow-sm'
            : 'border-gray-200 hover:border-gray-300'
        } ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50' : ''}`}
      >
        <div className="flex items-center gap-1.5 truncate flex-1 pr-2">
          {selectedProduct ? (
            <>
              <span className="font-bold text-gray-900 truncate">{selectedProduct.item_name}</span>
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
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
            isOpen ? 'rotate-180 text-purple-600' : ''
          }`}
        />
      </button>

      {/* Portal Dropdown Menu */}
      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              maxHeight: `${coords.maxHeight}px`,
              zIndex: 99999,
            }}
            onKeyDown={handleMenuKeyDown}
            className="bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Search Input Bar */}
            <div className="p-2 border-b border-gray-100 bg-slate-50 flex items-center gap-2 shrink-0">
              <Search className="w-3.5 h-3.5 text-gray-400 ml-1 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setHighlightedIndex(0);
                }}
                placeholder="Type product name or SKU..."
                className="w-full text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-purple-500 font-medium text-gray-900"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setHighlightedIndex(0);
                    searchInputRef.current?.focus();
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Scrollable Options List */}
            <div
              ref={optionsListRef}
              className="overflow-y-auto flex-1 divide-y divide-gray-50 p-1 overscroll-contain"
              style={{ maxHeight: `${Math.max(100, coords.maxHeight - 50)}px` }}
              role="listbox"
            >
              {filtered.length === 0 ? (
                <div className="py-6 px-3 text-center text-gray-400 space-y-1">
                  <Package className="w-6 h-6 mx-auto text-gray-300" />
                  <p className="text-xs font-semibold text-gray-600">No products match &ldquo;{searchTerm}&rdquo;</p>
                  <p className="text-[11px] text-gray-400">Try searching with another keyword or change category.</p>
                </div>
              ) : (
                filtered.map((p, idx) => {
                  const isSelected =
                    selectedProduct?.id === p.id ||
                    (selectedProduct?.item_name || '').toLowerCase() === (p.item_name || '').toLowerCase();
                  const isHighlighted = highlightedIndex === idx;
                  const isAlreadyAdded =
                    !isSelected &&
                    Array.isArray(excludeItemNames) &&
                    excludeItemNames.some(
                      (name) => (name || '').trim().toLowerCase() === (p.item_name || '').trim().toLowerCase()
                    );

                  return (
                    <div
                      key={p.id || `${p.item_name}-${idx}`}
                      ref={(el) => (optionRefs.current[idx] = el)}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onMouseDown={(e) => {
                        // Crucial: prevent input blur before onClick executes
                        e.preventDefault();
                      }}
                      onClick={() => handleSelectProduct(p)}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors cursor-pointer select-none ${
                        isHighlighted
                          ? 'bg-purple-100 text-purple-950 font-bold'
                          : isSelected
                          ? 'bg-purple-50 text-purple-900 font-bold'
                          : 'hover:bg-slate-50 text-gray-800'
                      }`}
                    >
                      <div className="truncate pr-2 flex-1">
                        <div className="font-semibold text-xs flex items-center gap-1.5 truncate">
                          <span className="truncate">{p.item_name}</span>
                          {p.sku && p.sku !== 'N/A' && (
                            <span className="text-[10px] text-gray-400 font-mono font-normal shrink-0">
                              ({p.sku})
                            </span>
                          )}
                          {isAlreadyAdded && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200 font-bold shrink-0">
                              In another row
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                          <span>
                            Category: <strong className="text-gray-600 font-normal">{p.category}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            In Store:{' '}
                            <strong className="text-gray-700 font-mono">
                              {p.available_stock ?? p.current_stock ?? 0} {p.unit || 'Nos.'}
                            </strong>
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isSelected && <Check className="w-3.5 h-3.5 text-purple-700" />}
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-gray-100 text-gray-700 rounded border border-gray-200">
                          {p.unit || 'Nos.'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
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
          const previouslyCarried = Boolean(job.carry_extra_backup_items ?? job.extra_devices);
          setHasBackupItems(previouslyCarried);
          setNoItemsReason('');
          setDeclarationStatus('NOT_RECORDED');
          setDeclarationTimestamp(null);
          setHistory([]);
          setItems([]);
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

  // Add Extra Device button adds a new independent row without resetting other rows
  const handleAddItemRow = (initialDeviceType = '') => {
    setItems((prev) => [
      ...prev,
      {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        category: 'Device Component',
        item_name: initialDeviceType,
        quantity: 1,
        unit: 'Nos.',
        sku: '',
        material_id: null,
      },
    ]);
  };

  const handleRemoveItemRow = (id) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleDeviceTypeChange = (rowId, newDeviceType) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        const matched = availableProducts.find(
          (p) => (p.item_name || '').toLowerCase() === newDeviceType.toLowerCase()
        );
        return {
          ...it,
          category: 'Device Component',
          item_name: newDeviceType,
          unit: matched?.unit || 'Nos.',
          sku: matched?.sku || '',
          material_id: matched?.id || matched?.material_id || null,
        };
      })
    );
  };

  const handleCategoryChange = (rowId, newCategory) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        return {
          ...it,
          category: newCategory,
        };
      })
    );
  };

  const handleProductSelect = (rowId, product) => {
    if (!product) return;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== rowId) return it;
        return {
          ...it,
          category: 'Device Component',
          item_name: product.item_name,
          unit: product.unit || 'Nos.',
          sku: product.sku || '',
          material_id: product.id || product.item_id || null,
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
      handleAddItemRow(EXTRA_DEVICE_OPTIONS[0]);
    }
  };

  const validate = () => {
    if (hasBackupItems) {
      if (!items || items.length === 0) {
        return 'Please add at least one extra backup device.';
      }
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.item_name || !it.item_name.trim()) {
          return `Row #${i + 1}: Please select an Extra Device Type from the dropdown.`;
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
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 1. Modal Header (Pinned at Top) */}
        <div className="bg-gradient-to-r from-purple-900 via-indigo-950 to-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0 border-b border-purple-800/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-200 shadow-inner">
              <Package size={19} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight">Pre-Installation: Extra Items</h3>
                <span className="text-[10px] uppercase font-extrabold tracking-wider px-2.5 py-0.5 rounded-full bg-purple-800/80 text-purple-200 border border-purple-500/30">
                  {declarationStatus === 'CORRECTED'
                    ? 'Corrected'
                    : declarationStatus === 'DECLARED'
                    ? 'Declared'
                    : 'Not Recorded'}
                </span>
              </div>
              <p className="text-xs text-purple-200/80 mt-0.5">
                Checklist #{job.checklist_number} • Client: <strong>{job.client_name}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-purple-200 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* 2. Scrollable Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 flex-1 overflow-y-auto">
          {/* Alerts */}
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2.5">
              <AlertTriangle size={17} className="text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2.5">
              <CheckCircle2 size={17} className="text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Business Rule Banner */}
          <div className="p-3 bg-purple-50/80 border border-purple-200/80 rounded-xl text-xs text-purple-950 flex items-start gap-2.5">
            <Info size={16} className="text-purple-700 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Extra backup items are individual components and installation materials carried for site contingencies. They are maintained as loose stock and do not alter customer device quantities or the Sales preliminary BOM. Stock is deducted only during authorized Store issuance.
            </p>
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2.5 text-purple-600" />
              <p className="text-xs font-semibold text-gray-600">Loading product catalogue...</p>
            </div>
          ) : (
            <form id="backup-declaration-form" onSubmit={handleSubmit} className="space-y-4">
              {/* Technician Declaration Radio */}
              <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-3 shadow-2xs">
                <label className="block text-xs font-bold text-gray-900">
                  Are you carrying extra backup items / hardware for this job? <span className="text-rose-500">*</span>
                </label>
                <div className="flex flex-wrap items-center gap-6">
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

                {!hasBackupItems && (
                  <div className="pt-2 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500 bg-slate-50/80 p-2.5 rounded-lg">
                    <Info size={15} className="text-slate-400 shrink-0" />
                    <span>No extra backup items declared. Only the customer's required installation devices will be prepared.</span>
                  </div>
                )}
              </div>

              {/* Extra Items Entry Table */}
              {hasBackupItems && (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                        Extra Devices Declaration Table
                      </h4>
                      <p className="text-[11px] text-gray-500">
                        Select extra device type and enter the quantity to carry to the site.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {items.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm('Are you sure you want to clear all declared extra devices from this list?')) {
                              setItems([]);
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                          title="Clear all declared devices from list"
                        >
                          <Trash2 size={14} /> Clear All
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleAddItemRow()}
                        className="px-3.5 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                      >
                        <Plus size={15} /> Add Extra Device
                      </button>
                    </div>
                  </div>

                  {/* Desktop Table View */}
                  <div className="hidden md:block border border-gray-200 rounded-xl bg-white shadow-2xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100/90 border-b border-gray-200 text-gray-700 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-3 px-3 w-12 text-center text-gray-400">#</th>
                          <th className="py-3 px-3 min-w-[280px]">Extra Device Type</th>
                          <th className="py-3 px-3 w-36 text-center">Quantity to Carry</th>
                          <th className="py-3 px-3 w-24 text-center">Unit</th>
                          <th className="py-3 px-3 w-16 text-center">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {items.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-gray-400 italic">
                              No extra devices declared yet. Click &ldquo;+ Add Extra Device&rdquo; above to add a row.
                            </td>
                          </tr>
                        ) : (
                          items.map((it, idx) => {
                            return (
                              <tr key={it.id} className="hover:bg-slate-50/70 transition-colors">
                                <td className="py-3 px-3 font-mono font-bold text-gray-400 text-center align-middle">
                                  {idx + 1}
                                </td>
                                <td className="py-3 px-3 align-middle min-w-[280px]">
                                  <select
                                    value={it.item_name}
                                    onChange={(e) => handleDeviceTypeChange(it.id, e.target.value)}
                                    className="w-full text-xs p-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-semibold bg-white text-gray-800 cursor-pointer transition-all"
                                    required
                                  >
                                    <option value="">-- Select Extra Device Type --</option>
                                    {EXTRA_DEVICE_OPTIONS.map((typeOption) => (
                                      <option key={typeOption} value={typeOption}>
                                        {typeOption}
                                      </option>
                                    ))}
                                    {it.item_name && !EXTRA_DEVICE_OPTIONS.includes(it.item_name) && (
                                      <option value={it.item_name}>
                                        {it.item_name} (Historical)
                                      </option>
                                    )}
                                  </select>
                                </td>
                                <td className="py-3 px-3 align-middle">
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={it.quantity}
                                    onChange={(e) => handleItemChange(it.id, 'quantity', e.target.value)}
                                    placeholder="1"
                                    className="w-full text-xs p-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-bold font-mono text-center text-gray-900 bg-white transition-all"
                                    required
                                  />
                                </td>
                                <td className="py-3 px-3 align-middle">
                                  <div className="flex items-center justify-center px-2 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-slate-800 font-bold font-mono text-xs select-none">
                                    <span>{it.unit || 'Nos.'}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-3 text-center align-middle">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveItemRow(it.id)}
                                    className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-2 rounded-lg transition-colors cursor-pointer"
                                    title="Remove row"
                                  >
                                    <Trash2 size={16} />
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
                      <div className="p-5 border border-dashed border-gray-300 rounded-xl text-center text-gray-400 text-xs italic">
                        No extra devices declared yet. Click &ldquo;+ Add Extra Device&rdquo; above to add a row.
                      </div>
                    ) : (
                      items.map((it, idx) => {
                        return (
                          <div key={it.id} className="p-4 bg-white border border-gray-200 rounded-xl space-y-3 shadow-2xs">
                            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                              <span className="font-bold text-xs text-purple-900 font-mono">
                                Device #{idx + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveItemRow(it.id)}
                                className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded-lg transition-colors cursor-pointer text-xs flex items-center gap-1 font-semibold"
                              >
                                <Trash2 size={14} /> Remove
                              </button>
                            </div>
                            <div className="space-y-2.5">
                              <div>
                                <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                                  Extra Device Type
                                </label>
                                <select
                                  value={it.item_name}
                                  onChange={(e) => handleDeviceTypeChange(it.id, e.target.value)}
                                  className="w-full text-xs p-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-semibold bg-white text-gray-800 cursor-pointer"
                                  required
                                >
                                  <option value="">-- Select Extra Device Type --</option>
                                  {EXTRA_DEVICE_OPTIONS.map((typeOption) => (
                                    <option key={typeOption} value={typeOption}>
                                      {typeOption}
                                    </option>
                                  ))}
                                  {it.item_name && !EXTRA_DEVICE_OPTIONS.includes(it.item_name) && (
                                    <option value={it.item_name}>
                                      {it.item_name} (Historical)
                                    </option>
                                  )}
                                </select>
                              </div>
                              <div className="grid grid-cols-2 gap-2.5">
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                                    Quantity
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={it.quantity}
                                    onChange={(e) => handleItemChange(it.id, 'quantity', e.target.value)}
                                    placeholder="1"
                                    className="w-full text-xs p-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 font-bold font-mono text-center text-gray-900 bg-white"
                                    required
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                                    Unit
                                  </label>
                                  <div className="w-full text-xs p-2.5 bg-slate-100 border border-slate-200 rounded-lg font-bold font-mono text-center text-slate-800">
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

                  {/* Declaration Summary Box */}
                  {items.length > 0 && (
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center justify-between font-bold text-gray-700">
                        <span className="flex items-center gap-1.5 uppercase text-[10px] tracking-wider text-purple-950 font-bold">
                          <Package size={14} className="text-purple-600" /> Declaration Summary
                        </span>
                        <span className="text-[11px] font-mono font-bold text-purple-800 bg-purple-100/70 px-2 py-0.5 rounded border border-purple-200">
                          {items.filter((it) => it.item_name && Number(it.quantity) > 0).length} declared product line(s)
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {items
                          .filter((it) => it.item_name && Number(it.quantity) > 0)
                          .map((it, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-gray-800 font-medium text-[11px] shadow-2xs"
                            >
                              <span className="text-gray-500 text-[10px]">
                                [{it.category === 'Device Component' ? 'Device' : 'Mat'}]:
                              </span>
                              <span className="font-semibold text-gray-900">{it.item_name}:</span>
                              <strong className="text-purple-800 font-mono">
                                {it.quantity} {it.unit || 'Nos.'}
                              </strong>
                            </span>
                          ))}
                      </div>
                      <p className="text-[10px] text-gray-400 italic">
                        * Note: This declaration records what the technician carries to the site. Store Manager physically verifies and records stock movements upon issuance.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Revision History Preview */}
              {history.length > 0 && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-700 uppercase tracking-wider">
                    <History size={13} className="text-purple-600" /> Revision History ({history.length})
                  </div>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {history.map((h, i) => (
                      <div
                        key={i}
                        className="text-[10px] text-gray-600 flex items-center justify-between bg-white px-2.5 py-1 rounded border border-gray-100"
                      >
                        <span>
                          Modified by <strong>{h.modified_by}</strong> ({h.previous_items_count} items)
                        </span>
                        <span className="font-mono text-gray-400">{new Date(h.modified_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamp footer indicator */}
              {declarationTimestamp && (
                <div className="text-[10px] text-gray-400 flex items-center gap-1.5 font-mono">
                  <ShieldCheck size={13} className="text-emerald-500" /> Last recorded:{' '}
                  {new Date(declarationTimestamp).toLocaleString()}
                </div>
              )}
            </form>
          )}
        </div>

        {/* 3. Modal Sticky Footer (Always Visible & Accessible) */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-gray-200 flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 hover:bg-gray-200/60 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="backup-declaration-form"
            disabled={submitting || loading}
            className="flex items-center gap-2 bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            <span>{submitting ? 'Saving...' : 'Save Declaration'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
