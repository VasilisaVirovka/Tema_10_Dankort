import { normalizeProductImages, supabase } from './supabase.js';

const FALLBACK_IMAGE = 'imgs/logo.webp';
const priceFormatter = new Intl.NumberFormat('da-DK', {
  style: 'currency',
  currency: 'DKK',
});

const productPageContent = document.querySelector('#productPageContent');

function formatPrice(value) {
  if (value === null || value === undefined || value === '') {
    return 'Pris ikke angivet';
  }

  const number = Number(value);

  if (Number.isNaN(number)) {
    return String(value);
  }

  return priceFormatter.format(number);
}

function getProductIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function normalizeColor(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getColorParamFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeColor(params.get('color'));
}

function capitalizeText(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return '';
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function resolveCatalogLabel(entry, fallback) {
  if (!entry) {
    return fallback;
  }

  return (
    String(entry?.name ?? '').trim() ||
    String(entry?.title ?? '').trim() ||
    String(entry?.label ?? '').trim() ||
    String(entry?.slug ?? '').trim() ||
    fallback
  );
}

function deriveCollectionMeta(productName) {
  const sourceName = String(productName ?? '').trim();

  if (!sourceName) {
    return { collectionName: '', collectionSlug: '' };
  }

  const match = sourceName.match(/\s*[–-]\s*/);
  const collectionBase = match ? sourceName.slice(0, match.index).trim() : '';

  if (!collectionBase) {
    return { collectionName: '', collectionSlug: '' };
  }

  const collectionSlug = collectionBase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return {
    collectionName: `${collectionBase} Collection`,
    collectionSlug,
  };
}

function getStockLabel(stock) {
  if (stock === null || stock === undefined || stock === '') {
    return 'Status ukendt';
  }

  const stockCount = Number(stock);

  if (Number.isNaN(stockCount)) {
    return String(stock);
  }

  if (stockCount <= 0) {
    return 'Udsolgt';
  }

  if (stockCount <= 3) {
    return `Kun ${stockCount} tilbage`;
  }

  return `${stockCount} på lager`;
}

function getColorLabel(colorKey) {
  if (colorKey === 'standard' || colorKey === 'default') {
    return 'Standard';
  }

  return capitalizeText(colorKey);
}

function getUniqueColors(productImages) {
  return [...new Set(productImages.map((image) => normalizeColor(image?.color)).filter(Boolean))];
}

function getSelectedColor(product, productImages) {
  const colorParam = getColorParamFromUrl();

  if (colorParam) {
    return colorParam;
  }

  const primaryImage = productImages.find((image) => image.is_primary);

  if (primaryImage?.color) {
    return normalizeColor(primaryImage.color);
  }

  const firstImage = productImages.find((image) => normalizeColor(image.color));

  if (firstImage?.color) {
    return normalizeColor(firstImage.color);
  }

  return normalizeColor(product?.color);
}

function normalizeProductPageImages(product) {
  const galleryImages = Array.isArray(product?.gallery_images) ? product.gallery_images : [];
  const fallbackImages = Array.isArray(product?.product_images)
    ? normalizeProductImages(product)
    : [];
  const sourceImages = galleryImages.length > 0 ? galleryImages : fallbackImages;

  if (sourceImages.length === 0 && product?.image_url) {
    return [{
      image_url: product.image_url,
      color: normalizeColor(product?.color),
      is_primary: true,
      sort_order: 0,
    }];
  }

  return sourceImages
    .filter((image) => Boolean(image?.image_url))
    .sort((a, b) => {
      if (a?.is_primary && !b?.is_primary) {
        return -1;
      }

      if (!a?.is_primary && b?.is_primary) {
        return 1;
      }

      return (Number(a?.sort_order) || 999) - (Number(b?.sort_order) || 999);
    })
    .map((image) => ({
      image_url: image.image_url,
      color: normalizeColor(image?.color),
      is_primary: Boolean(image?.is_primary),
      sort_order: Number(image?.sort_order) || 0,
    }));
}

function normalizeProductPageVariants(product, productImages) {
  const availableColors = Array.isArray(product?.available_colors) ? product.available_colors : [];

  if (availableColors.length > 0) {
    return availableColors
      .map((color) => normalizeColor(color))
      .filter(Boolean);
  }

  return getUniqueColors(productImages);
}

function parseDetails(details) {
  if (!details) {
    return [];
  }

  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details);
      return parseDetails(parsed);
    } catch (error) {
      return [
        {
          label: 'Detaljer',
          value: details,
        },
      ];
    }
  }

  if (Array.isArray(details)) {
    return details
      .map((detail) => {
        if (typeof detail === 'string') {
          return {
            label: 'Detaljer',
            value: detail,
          };
        }

        if (detail && typeof detail === 'object') {
          const label = detail.label || detail.name || detail.key || 'Detaljer';
          const value = detail.value ?? detail.description ?? detail.text ?? '';

          return {
            label: String(label),
            value: String(value),
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  if (typeof details === 'object') {
    return Object.entries(details)
      .map(([key, value]) => ({
        label: capitalizeText(key.replace(/[_-]+/g, ' ')),
        value: Array.isArray(value) ? value.join(', ') : String(value),
      }))
      .filter((entry) => entry.value !== 'undefined' && entry.value !== 'null' && entry.value !== '');
  }

  return [];
}

function renderLoadingState() {
  if (!productPageContent) {
    return;
  }

  productPageContent.innerHTML = `
    <section class="product-page__state" role="status" aria-live="polite">
      <div>
        <h2>Indlæser produkt…</h2>
        <p>Vi henter data fra Supabase og opdaterer siden.</p>
      </div>
    </section>`;
}

function renderErrorState(message) {
  if (!productPageContent) {
    return;
  }

  productPageContent.innerHTML = `
    <section class="product-page__state">
      <div>
        <h2>Produktet kunne ikke indlæses</h2>
        <p>${message}</p>
        <a href="shop.html" class="product-card__ghost">Tilbage til shop</a>
      </div>
    </section>`;
}

function renderMissingIdState() {
  renderErrorState('Vælg et produkt fra shoppen for at åbne denne side.');
}

function renderNotFoundState() {
  renderErrorState('Produktet kunne ikke findes.');
}

function addToCart() {
  return;
}

function renderProductImages(productImages = [], selectedColor = null, productTitle = 'Produkt') {
  const validImages = (Array.isArray(productImages) ? productImages : []).filter((image) => Boolean(image?.image_url));
  const normalizedSelectedColor = normalizeColor(selectedColor);
  const colorMatched = normalizedSelectedColor
    ? validImages.filter((image) => normalizeColor(image?.color) === normalizedSelectedColor)
    : [];
  const imagesToRender = colorMatched.length > 0 ? colorMatched : validImages;

  if (imagesToRender.length === 0) {
    return `
      <div class="product-page__gallery-empty">
        <img src="${FALLBACK_IMAGE}" alt="Product image placeholder" class="product-image" loading="lazy" />
      </div>`;
  }

  const slides = imagesToRender
    .map(
      (image) => `
        <div class="carousel-slide product-page__gallery-slide" data-color="${normalizeColor(image?.color) || 'standard'}">
          <img src="${image.image_url}" alt="${image.color || productTitle}" loading="lazy" />
        </div>`
    )
    .join('');

  return `
    <div class="carousel product-page__gallery-carousel ${imagesToRender.length <= 1 ? 'is-single' : ''}" data-current-index="0">
      <div class="carousel-track">
        ${slides}
      </div>
      <button class="carousel-btn prev" type="button" aria-label="Forrige billede">‹</button>
      <button class="carousel-btn next" type="button" aria-label="Næste billede">›</button>
    </div>`;
}

function renderColorOptions(colorOptions, selectedColor) {
  const colors = Array.isArray(colorOptions)
    ? colorOptions
        .map((option) => normalizeColor(typeof option === 'string' ? option : option?.color))
        .filter(Boolean)
    : [];

  if (colors.length === 0) {
    return '';
  }

  return `
    <div class="product-page__color-options">
      ${colors
        .map(
          (color) => `
            <button
              type="button"
              class="product-page__color-button ${normalizeColor(selectedColor) === color ? 'product-page__color-button--active' : ''}"
              data-color-value="${color}"
            >
              ${getColorLabel(color)}
            </button>`
        )
        .join('')}
    </div>`;
}

function renderProductDetails(details) {
  const detailItems = parseDetails(details);

  if (detailItems.length === 0) {
    return `
      <section class="product-page__details-card">
        <h2>Produktdetaljer</h2>
        <p class="product-page__empty-details">Ingen specifikke detaljer er angivet for dette produkt.</p>
      </section>`;
  }

  return `
    <section class="product-page__details-card">
      <h2>Produktdetaljer</h2>
      <div class="product-page__details-list">
        ${detailItems
          .map(
            (item) => `
              <div class="product-page__detail-item">
                <span class="product-page__detail-label">${item.label}</span>
                <span class="product-page__detail-value">${item.value}</span>
              </div>`
          )
          .join('')}
      </div>
    </section>`;
}

function updateProductGallery(carousel) {
  if (!carousel) {
    return;
  }

  const track = carousel.querySelector('.carousel-track');
  const slides = Array.from(carousel.querySelectorAll('.carousel-slide'));
  const prevButton = carousel.querySelector('.carousel-btn.prev');
  const nextButton = carousel.querySelector('.carousel-btn.next');

  if (!track || slides.length === 0) {
    return;
  }

  const currentIndex = Math.max(0, Math.min(Number(carousel.dataset.currentIndex || 0), slides.length - 1));
  carousel.dataset.currentIndex = String(currentIndex);
  track.style.transform = `translateX(-${currentIndex * 100}%)`;

  if (prevButton) {
    prevButton.disabled = currentIndex === 0;
    prevButton.classList.toggle('is-disabled', currentIndex === 0);
  }

  if (nextButton) {
    nextButton.disabled = currentIndex === slides.length - 1;
    nextButton.classList.toggle('is-disabled', currentIndex === slides.length - 1);
  }
}

function bindProductGallery() {
  const carousel = productPageContent?.querySelector('.product-page__gallery-carousel');

  if (!carousel) {
    return;
  }

  const prevButton = carousel.querySelector('.carousel-btn.prev');
  const nextButton = carousel.querySelector('.carousel-btn.next');

  if (!prevButton || !nextButton) {
    updateProductGallery(carousel);
    return;
  }

  prevButton.onclick = () => {
    const currentIndex = Number(carousel.dataset.currentIndex || 0) - 1;
    carousel.dataset.currentIndex = String(Math.max(0, currentIndex));
    updateProductGallery(carousel);
  };

  nextButton.onclick = () => {
    const currentIndex = Number(carousel.dataset.currentIndex || 0) + 1;
    carousel.dataset.currentIndex = String(currentIndex);
    updateProductGallery(carousel);
  };

  updateProductGallery(carousel);
}

function bindColorSelector(productImages, selectedColor, productTitle) {
  const colorButtons = productPageContent?.querySelectorAll('.product-page__color-button');
  const gallery = productPageContent?.querySelector('#productGallery');

  if (!gallery || colorButtons.length === 0) {
    return;
  }

  let currentSelectedColor = normalizeColor(selectedColor);

  colorButtons.forEach((button) => {
    button.classList.toggle(
      'product-page__color-button--active',
      normalizeColor(button.dataset.colorValue) === currentSelectedColor
    );

    button.addEventListener('click', () => {
      currentSelectedColor = normalizeColor(button.dataset.colorValue);

      colorButtons.forEach((item) => {
        item.classList.toggle('product-page__color-button--active', item === button);
      });

      gallery.innerHTML = renderProductImages(productImages, currentSelectedColor, productTitle);
      bindProductGallery();
    });
  });
}

function renderProductPage(product) {
  if (!productPageContent) {
    return;
  }

  const productImages = normalizeProductPageImages(product);
  const colorValues = normalizeProductPageVariants(product, productImages);
  const selectedColor = getSelectedColor(product, productImages) || colorValues[0] || normalizeColor(product?.color) || null;
  const productTitle = product?.title || product?.name || 'Produkt';
  const categoryName = product?.category_name || resolveCatalogLabel(product?.categories, 'Ukendt kategori');
  const derivedCollection = deriveCollectionMeta(product?.name || product?.title || '');
  const collectionName = String(product?.collectionName || product?.collection_name || product?.collections?.name || derivedCollection.collectionName || '').trim();
  const collectionSlug = String(product?.collectionSlug || product?.collection_slug || product?.collections?.slug || derivedCollection.collectionSlug || '').trim();
  const stockLabel = getStockLabel(product?.stock);
  const stockCount = Number(product?.stock ?? 0);
  const description = product?.description || 'Der er ingen beskrivelse tilgængelig for dette produkt.';
  const price = Number(product?.price ?? 0);
  const colorOptions = renderColorOptions(
    colorValues.map((color) => ({
      color,
      image_url: productImages.find((image) => normalizeColor(image.color) === color)?.image_url || product?.image_url || '',
    })),
    selectedColor
  );

  productPageContent.innerHTML = `
    <section class="product-page__hero">
      ${product?.is_new ? '<span class="product-page__eyebrow">NYHED!</span>' : ''}
      <h1 class="product-page__title">${product?.name || 'Produkt'}</h1>
      <p class="product-page__subtitle">${collectionName}</p>
    </section>

    <section class="product-page__layout">
      <div class="product-page__gallery-card">
        <div id="productGallery" class="product-page__gallery-wrapper">
          ${renderProductImages(productImages, selectedColor, productTitle)}
        </div>
        ${colorOptions ? `<div class="product-page__color-panel">${colorOptions}</div>` : ''}
      </div>

      <aside class="product-page__info-card">
        <div class="product-page__meta">
          <p class="product-page__category">Kategori: ${categoryName}</p>
          <p class="product-page__collection">Kollektion: ${collectionName}</p>
          <h2 class="product-page__product-name">${product?.name || 'Produkt'}</h2>
        </div>

        <div class="product-page__meta-grid">
          <div class="product-page__meta-item">
            <p class="product-page__meta-label">Pris</p>
            <p class="product-page__meta-value">${formatPrice(price)}</p>
          </div>
          <div class="product-page__meta-item">
            <p class="product-page__meta-label">Lagerstatus</p>
            <p class="product-page__meta-value ${stockCount <= 3 && stockCount > 0 ? 'product-page__meta-value--warning' : ''}">${stockLabel}</p>
          </div>
        </div>

        <div class="product-page__description-block">
          <h2>Produktbeskrivelse</h2>
          <p class="product-page__description">${description}</p>
        </div>

        <div class="product-page__actions">
          <button type="button" class="product-card__button product-page__cta" ${stockCount <= 0 ? 'disabled' : ''}>
            ${stockCount <= 0 ? 'Udsolgt' : 'Læg i kurv'}
          </button>
          <a href="shop.html" class="product-card__ghost">← Tilbage til shop</a>
        </div>
      </aside>
    </section>

    ${renderProductDetails(product?.details)}`;

  const addToCartButton = productPageContent.querySelector('.product-page__cta');

  addToCartButton?.addEventListener('click', () => {
    addToCart(product);
  });

  bindProductGallery();
  bindColorSelector(productImages, selectedColor, productTitle);
}

async function fetchCatalogEntry(tableName, id) {
  if (!id) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error(error);
      return null;
    }

    return data;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function fetchSingleProduct(productId) {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        id,
        name,
        description,
        price,
        stock,
        color,
        is_new,
        is_featured,
        discount_percent,
        category_id,
        collection_id,
        category_name,
        collection_name,
        category_slug,
        collection_slug,
        image_url,
        gallery_images,
        available_colors,
        details,
        collections(
          id,
          name,
          slug
        ),
        product_images(
          id,
          product_id,
          image_url,
          color,
          is_primary,
          sort_order
        )
      `)
      .eq('id', productId)
      .single();

    if (error) {
      console.error(error);
      return { error };
    }

    if (!data) {
      return { data: null };
    }

    const derivedCollection = deriveCollectionMeta(data?.name || data?.title || '');
    const collectionName = String(data.collection_name || data.collections?.name || derivedCollection.collectionName || '').trim();
    const collectionSlug = String(data.collection_slug || data.collections?.slug || derivedCollection.collectionSlug || '').trim();

    const [categoryData, collectionData] = await Promise.all([
      data.category_name ? null : fetchCatalogEntry('categories', data.category_id),
      collectionName ? null : fetchCatalogEntry('collections', data.collection_id),
    ]);

    return {
      data: {
        ...data,
        collectionName,
        collectionSlug,
        categories: categoryData,
        collections: collectionData || data.collections,
      },
    };
  } catch (error) {
    console.error(error);
    return { error };
  }
}

async function loadProduct() {
  const productId = getProductIdFromUrl();

  if (!productId) {
    renderMissingIdState();
    return;
  }

  renderLoadingState();

  const { data, error } = await fetchSingleProduct(productId);

  if (error) {
    console.error(error);

    if (error.code === '22P02' || error.code === 'PGRST116') {
      renderNotFoundState();
      return;
    }

    renderErrorState('Der opstod en fejl ved henting af produktet. Prøv igen om lidt.');
    return;
  }

  if (!data) {
    renderNotFoundState();
    return;
  }

  renderProductPage(data);
}

loadProduct();
