import { supabase } from './supabase.js';

const DEFAULT_FILTERS = {
  query: '',
  sortMode: 'featured',
  priceFilter: 'all',
  categoryFilter: '',
  collectionFilter: '',
};

function getElement(selector) {
  return document.querySelector(selector);
}

function normalizeOptionValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getSummaryElement() {
  return getElement('#resultsSummary');
}

function updateSummary(count) {
  const summary = getSummaryElement();

  if (!summary) {
    return;
  }

  summary.textContent = `${count} produkt${count === 1 ? '' : 'er'} vist`;
}

function hideFilterGroup(groupName, hidden) {
  const wrapper = getElement(`[data-filter-group="${groupName}"]`);

  if (wrapper) {
    wrapper.style.display = hidden ? 'none' : '';
  }
}

function populateSelect(select, options, selectedValue, placeholderLabel = 'Alle') {
  if (!select) {
    return;
  }

  const currentValue = normalizeOptionValue(select.value);
  const optionValues = new Set();

  select.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = placeholderLabel;
  select.appendChild(placeholder);

  options.forEach((option) => {
    const normalizedValue = normalizeOptionValue(option.id);

    if (optionValues.has(normalizedValue)) {
      return;
    }

    optionValues.add(normalizedValue);

    const element = document.createElement('option');
    element.value = normalizedValue;
    element.textContent = option.label;
    select.appendChild(element);
  });

  const normalizedSelected = normalizeOptionValue(selectedValue);
  const hasSelectedOption = options.some((option) => normalizeOptionValue(option.id) === normalizedSelected);

  if (hasSelectedOption) {
    select.value = normalizedSelected;
  } else {
    select.value = '';
  }

  if (currentValue && currentValue !== select.value && options.some((option) => normalizeOptionValue(option.id) === currentValue)) {
    select.value = currentValue;
  }
}

function buildCatalogOptions(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: row?.id ?? '',
      label: row?.name || row?.title || row?.label || row?.slug || 'Ukendt',
    }))
    .filter((row) => Boolean(row.id) && Boolean(row.label));
}

function buildProductFilterOptions(products) {
  const categoryOptions = [];
  const collectionOptions = [];
  const categoryIds = new Set();
  const collectionIds = new Set();

  (Array.isArray(products) ? products : []).forEach((product) => {
    const categoryId = normalizeOptionValue(product?.categoryId ?? product?.category_id);
    const collectionId = normalizeOptionValue(product?.collectionId ?? product?.collection_id);
    const categoryName = String(product?.categoryName ?? product?.category_name ?? '').trim();
    const collectionName = String(product?.collectionName ?? product?.collection_name ?? '').trim();
    const categorySlug = String(product?.categorySlug ?? product?.category_slug ?? '').trim();
    const collectionSlug = String(product?.collectionSlug ?? product?.collection_slug ?? '').trim();

    if (categoryId && !categoryIds.has(categoryId)) {
      categoryIds.add(categoryId);
      categoryOptions.push({
        id: categoryId,
        label: categoryName || categorySlug || `Kategori ${categoryOptions.length + 1}`,
      });
    }

    if (collectionId && !collectionIds.has(collectionId)) {
      collectionIds.add(collectionId);
      collectionOptions.push({
        id: collectionId,
        label: collectionName || collectionSlug || `Kollektion ${collectionOptions.length + 1}`,
      });
    }
  });

  return {
    categories: categoryOptions,
    collections: collectionOptions,
  };
}

function syncFilterUI(filters, categories, collections) {
  populateSelect(getElement('#categoryFilter'), categories, filters.categoryFilter, 'Alle kategorier');
  populateSelect(getElement('#collectionFilter'), collections, filters.collectionFilter, 'Alle kollektioner');
}

function matchesPriceFilter(product, priceFilter) {
  const price = Number(product.rawPrice ?? 0);

  switch (priceFilter) {
    case 'under-50':
      return price < 50;
    case '50-100':
      return price >= 50 && price <= 100;
    case 'over-100':
      return price > 100;
    case 'all':
    default:
      return true;
  }
}

function matchesCategoryFilter(product, categoryFilter) {
  const selectedCategoryId = normalizeOptionValue(categoryFilter);

  if (!selectedCategoryId) {
    return true;
  }

  const productCategoryId = normalizeOptionValue(product.categoryId ?? product.category_id);

  return productCategoryId === selectedCategoryId;
}

function matchesCollectionFilter(product, collectionFilter) {
  const selectedCollectionId = normalizeOptionValue(collectionFilter);

  if (!selectedCollectionId) {
    return true;
  }

  const productCollectionId = normalizeOptionValue(product.collectionId ?? product.collection_id);

  return productCollectionId === selectedCollectionId;
}

function filterProducts(products, filters) {
  const query = filters.query.trim().toLowerCase();

  const filtered = products
    .filter((product) => {
      const text = product.searchText || '';
      return !query || text.includes(query);
    })
    .filter((product) => matchesPriceFilter(product, filters.priceFilter))
    .filter((product) => matchesCategoryFilter(product, filters.categoryFilter))
    .filter((product) => matchesCollectionFilter(product, filters.collectionFilter));

  return filtered.sort((a, b) => {
    switch (filters.sortMode) {
      case 'price-asc':
        return a.rawPrice - b.rawPrice;
      case 'price-desc':
        return b.rawPrice - a.rawPrice;
      case 'title-asc':
        return a.title.localeCompare(b.title, 'da');
      case 'title-desc':
        return b.title.localeCompare(a.title, 'da');
      case 'featured':
      default:
        if (b.isFeatured !== a.isFeatured) {
          return Number(b.isFeatured) - Number(a.isFeatured);
        }

        if (b.isNew !== a.isNew) {
          return Number(b.isNew) - Number(a.isNew);
        }

        return a.title.localeCompare(b.title, 'da');
    }
  });
}

export function createProductFilters({ onChange }) {
  const controls = {
    searchInput: getElement('#searchInput'),
    sortSelect: getElement('#sortSelect'),
    priceFilter: getElement('#priceFilter'),
    categoryFilter: getElement('#categoryFilter'),
    collectionFilter: getElement('#collectionFilter'),
  };

  const filters = { ...DEFAULT_FILTERS };
  let products = [];
  let categories = [];
  let collections = [];

  function applyFilters() {
    const filteredProducts = filterProducts(products, filters);
    onChange(filteredProducts);
    updateSummary(filteredProducts.length);
  }

  function setProducts(nextProducts) {
    products = Array.isArray(nextProducts) ? nextProducts : [];
    syncFilterUI(filters, categories, collections);
    applyFilters();
  }

  function setMetadata(nextMetadata = {}) {
    categories = Array.isArray(nextMetadata.categories) ? nextMetadata.categories : [];
    collections = Array.isArray(nextMetadata.collections) ? nextMetadata.collections : [];
    syncFilterUI(filters, categories, collections);
    applyFilters();
  }

  async function loadMetadata() {
    const productOptions = buildProductFilterOptions(products);

    if (productOptions.categories.length > 0 || productOptions.collections.length > 0) {
      setMetadata(productOptions);
      return;
    }

    const categoriesResponse = await supabase
      .from('categories')
      .select('id, slug')
      .order('slug', { ascending: true });

    if (categoriesResponse.error) {
      console.error('Error fetching categories:', categoriesResponse.error);
    }

    const collectionsResponse = await supabase
      .from('collections')
      .select('id, name, slug')
      .order('name', { ascending: true });

    if (collectionsResponse.error) {
      console.error('Error fetching collections:', collectionsResponse.error);
    }

    setMetadata({
      categories: buildCatalogOptions(categoriesResponse.data),
      collections: buildCatalogOptions(collectionsResponse.data),
    });
  }

  function handleChange() {
    if (controls.searchInput) {
      filters.query = controls.searchInput.value;
    }

    if (controls.sortSelect) {
      filters.sortMode = controls.sortSelect.value;
    }

    if (controls.priceFilter) {
      filters.priceFilter = controls.priceFilter.value;
    }

    if (controls.categoryFilter) {
      filters.categoryFilter = controls.categoryFilter.value;
    }

    if (controls.collectionFilter) {
      filters.collectionFilter = controls.collectionFilter.value;
    }

    applyFilters();
  }

  Object.values(controls).forEach((control) => {
    if (!control) {
      return;
    }

    control.addEventListener('input', handleChange);
    control.addEventListener('change', handleChange);
  });

  return {
    setProducts,
    setMetadata,
    loadMetadata,
  };
}
