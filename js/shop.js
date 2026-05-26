import { normalizeProductImages, supabase } from './supabase.js';
import { createProductFilters } from './productFilters.js';

const FALLBACK_IMAGE = 'imgs/logo.webp';
const priceFormatter = new Intl.NumberFormat('da-DK', {
  style: 'currency',
  currency: 'DKK',
});

const shopContainer = document.querySelector('#shop');

function navigateToProduct(productId) {
  if (!productId) {
    return;
  }

  window.location.href = `product-page.html?id=${encodeURIComponent(productId)}`;
}

function isInteractiveTarget(target) {
  return Boolean(target?.closest('button, .product-card__swatch'));
}

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

function normalizeColor(value) {
  return String(value ?? '').trim().toLowerCase();
}

function capitalize(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return '';
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getLabel(value, fallback) {
  const text = String(value ?? '').trim();

  if (!text) {
    return fallback;
  }

  return capitalize(text);
}

function resolveCatalogLabel(entry, fallback) {
  if (!entry) {
    return fallback;
  }

  return (
    getLabel(entry.name, '') ||
    getLabel(entry.title, '') ||
    getLabel(entry.label, '') ||
    getLabel(entry.slug, '') ||
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

function getProductImagesFromData(product) {
  const galleryImages = Array.isArray(product?.gallery_images) ? product.gallery_images : [];
  const imageRows = Array.isArray(product?.product_images) ? product.product_images : [];

  return [...galleryImages, ...imageRows]
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

function getColorHex(colorName) {
  const normalized = normalizeColor(colorName);

  if (!normalized) {
    return '#d9d9d9';
  }

  switch (normalized) {
    case 'black':
    case 'mørk':
    case 'navy':
      return '#111111';
    case 'white':
    case 'hvid':
      return '#ffffff';
    case 'beige':
      return '#d8c0a4';
    case 'green':
    case 'grøn':
      return '#1b7b52';
    case 'red':
    case 'rød':
      return '#b53b3b';
    case 'blue':
    case 'blå':
      return '#2f6fe5';
    case 'brown':
    case 'brun':
      return '#8b5e3c';
    default:
      return '#d9d9d9';
  }
}

function buildCatalogOptions(rows, products, kind) {
  const validRows = toArray(rows)
    .map((row) => ({
      id: row?.id ?? row?.value ?? row?.slug ?? '',
      label: resolveCatalogLabel(row, ''),
    }))
    .filter((row) => Boolean(row.id) && Boolean(row.label));

  if (validRows.length > 0) {
    return validRows.sort((a, b) => a.label.localeCompare(b.label, 'da'));
  }

  const ids = new Set();

  products.forEach((product) => {
    const id = kind === 'category' ? product.categoryId : product.collectionId;

    if (id) {
      ids.add(id);
    }
  });

  return Array.from(ids).map((id, index) => ({
    id,
    label: kind === 'category' ? `Kategori ${index + 1}` : `Kollektion ${index + 1}`,
  }));
}

function normalizeImageVariants(images, fallbackImageUrl = FALLBACK_IMAGE) {
  const validImages = Array.isArray(images) ? images : [];

  if (validImages.length === 0) {
    return [
      {
        value: 'default',
        label: 'Standard',
        imageUrl: fallbackImageUrl,
        swatchColor: '#d9d9d9',
      },
    ];
  }

  const uniqueRows = new Map();

  validImages.forEach((image) => {
    const colorKey = normalizeColor(image?.color) || 'default';
    const imageUrl = image?.image_url || fallbackImageUrl;
    const variantKey = `${colorKey}::${imageUrl}`;

    if (!uniqueRows.has(variantKey)) {
      uniqueRows.set(variantKey, {
        value: colorKey,
        label: capitalize(colorKey) || 'Standard',
        imageUrl,
        swatchColor: getColorHex(colorKey),
      });
    }
  });

  return Array.from(uniqueRows.values());
}

function normalizeProduct(product) {
  const title = product?.name || '';
  const description = product?.description || '';
  const rawPrice = Number(product?.price ?? 0);
  const stockCount = Number(product?.stock ?? 0);
  const soldOut = stockCount <= 0;
  const categoryId = product?.category_id || null;
  const collectionId = product?.collection_id || null;
  const images = getProductImagesFromData(product);
  const primaryImage =
    product?.image_url ||
    images.find((image) => image.is_primary)?.image_url ||
    images[0]?.image_url ||
    '';
  const derivedCollection = deriveCollectionMeta(product?.name || product?.title || '');
  const collectionName = String(product?.collection_name || product?.collections?.name || derivedCollection.collectionName || '').trim();
  const collectionSlug = String(product?.collection_slug || product?.collections?.slug || derivedCollection.collectionSlug || '').trim();

  const availableColors = Array.isArray(product?.available_colors)
    ? product.available_colors
    : [];

  const variants = availableColors.length > 0
    ? availableColors
        .map((color) => {
          const normalizedColor = normalizeColor(color);

          return {
            value: normalizedColor,
            label: capitalize(normalizedColor),
            imageUrl: images.find((image) => image.color === normalizedColor)?.image_url || primaryImage,
            swatchColor: getColorHex(normalizedColor),
          };
        })
        .filter((variant) => Boolean(variant.value))
    : [
        ...new Set(
          images
            .map((image) => image.color)
            .filter(Boolean)
        ),
      ].map((color) => ({
        value: color,
        label: capitalize(color),
        imageUrl: images.find((image) => image.color === color)?.image_url || primaryImage,
        swatchColor: getColorHex(color),
      }));

  const activeVariant =
    images.find((image) => image.is_primary)?.color ||
    variants[0]?.value ||
    normalizeColor(product?.color) ||
    null;

  return {
    ...product,
    id: product?.id,
    title,
    description,
    rawPrice,
    price: formatPrice(rawPrice),
    stockLabel: getStockLabel(product?.stock),
    stockCount,
    stockClass: stockCount <= 3 ? 'product-card__stock--low' : '',
    soldOut,
    isNew: Boolean(product?.is_new),
    isFeatured: Boolean(product?.is_featured),
    discountPercent: Number(product?.discount_percent ?? 0),
    imageUrl: primaryImage,
    images,
    hasMultipleImages: images.length > 1,
    variants,
    activeVariant,
    categoryId,
    collectionId,
    categoryName: getLabel(product?.category_name, ''),
    collectionName,
    categorySlug: getLabel(product?.category_slug, ''),
    collectionSlug,
    collectionLabel: collectionName,
    color: normalizeColor(product?.color) || null,
    colorLabel: capitalize(product?.color),
    searchText: `${title} ${description} ${product?.category_name || ''} ${collectionName}`.toLowerCase(),
  };
}

function createBadgeMarkup(product) {
  const badges = [];

  if (product.isNew) {
    badges.push('<span class="product-card__badge product-card__badge--accent">NEW</span>');
  }

  if (product.isFeatured) {
    badges.push('<span class="product-card__badge product-card__badge--accent">FEATURED</span>');
  }

  if (product.discountPercent > 0) {
    badges.push(`<span class="product-card__badge product-card__badge--warning">-${Math.round(product.discountPercent)}%</span>`);
  }

  return badges.length > 0 ? `<div class="product-card__badges">${badges.join('')}</div>` : '';
}

function createCarouselMarkup(product) {
  const slides = product.images.length > 0
    ? product.images
        .map(
          (image) => `
            <div class="carousel-slide">
              <img src="${image.image_url}" alt="${product.title} ${image.color || ''}" class="product-card__image" loading="lazy" />
            </div>`
        )
        .join('')
    : `
      <div class="carousel-slide carousel-slide--fallback">
        <div class="carousel-placeholder">
          <p>Ingen billeder tilgængelige</p>
        </div>
      </div>`;

  return `
    <div class="carousel ${product.hasMultipleImages ? '' : 'is-single'}" data-current-index="0">
      <div class="carousel-track">
        ${slides}
      </div>
      <button class="carousel-btn prev" type="button" aria-label="Forrige billede">‹</button>
      <button class="carousel-btn next" type="button" aria-label="Næste billede">›</button>
    </div>`;
}

function createSwatchesMarkup(product) {
  if (!product.variants || product.variants.length === 0) {
    return '';
  }

  const chips = product.variants
    .map((variant) => {
      const isActive = variant.value === product.activeVariant;

      return `
        <button
          type="button"
          class="product-card__swatch ${isActive ? 'product-card__swatch--active' : ''}"
          data-color-key="${variant.value}"
          data-image-url="${variant.imageUrl}"
          style="background:${variant.swatchColor};"
          aria-label="Skift til ${variant.label}"
          aria-pressed="${isActive ? 'true' : 'false'}"
        ></button>`;
    })
    .join('');

  return `<div class="product-card__swatches">${chips}</div>`;
}

function createProductCard(product) {
  return `
    <article class="product-card" data-product-id="${product.id}" aria-label="Se detaljer for ${product.title}">
      <div class="product-card__visual">
        ${createCarouselMarkup(product)}
        ${createBadgeMarkup(product)}
      </div>

      <div class="product-card__content">
        <h3 class="product-card__title">${product.title}</h3>
        ${product.collectionName ? `<p class="product-card__collection">${product.collectionName}</p>` : ''}
        <p class="product-card__description">${product.description}</p>
        ${createSwatchesMarkup(product)}

        <div class="product-card__footer">
          <div>
            <p class="product-card__price">${product.price}</p>
            <p class="product-card__stock ${product.stockClass}">${product.stockLabel}</p>
          </div>

          <div class="product-card__actions">
            <button class="product-card__button" type="button" ${product.soldOut ? 'disabled' : ''}>
              ${product.soldOut ? 'Udsolgt' : 'Læg i kurv'}
            </button>
            
          </div>
        </div>
      </div>
    </article>`;
}

function getCarouselState(carousel) {
  if (!carousel) {
    return null;
  }

  return {
    track: carousel.querySelector('.carousel-track'),
    slides: carousel.querySelectorAll('.carousel-slide'),
    prev: carousel.querySelector('.carousel-btn.prev'),
    next: carousel.querySelector('.carousel-btn.next'),
  };
}

function updateCarousel(carousel, index) {
  const state = getCarouselState(carousel);

  if (!state || !state.track || state.slides.length === 0) {
    return;
  }

  const currentIndex = Math.max(0, Math.min(index, state.slides.length - 1));
  carousel.dataset.currentIndex = String(currentIndex);
  state.track.style.transform = `translateX(-${currentIndex * 100}%)`;

  if (state.prev) {
    state.prev.disabled = currentIndex === 0;
    state.prev.classList.toggle('is-disabled', currentIndex === 0);
  }

  if (state.next) {
    state.next.disabled = currentIndex === state.slides.length - 1;
    state.next.classList.toggle('is-disabled', currentIndex === state.slides.length - 1);
  }
}

function initializeCarousel(card) {
  const carousel = card.querySelector('.carousel');

  if (!carousel) {
    return;
  }

  const state = getCarouselState(carousel);

  if (!state) {
    return;
  }

  const slides = Array.from(state.slides);
  carousel.classList.toggle('is-single', slides.length <= 1);

  if (slides.length <= 1) {
    updateCarousel(carousel, 0);
    return;
  }

  if (state.prev) {
    state.prev.addEventListener('click', () => {
      const currentIndex = Number(carousel.dataset.currentIndex || 0);
      updateCarousel(carousel, currentIndex - 1);
    });
  }

  if (state.next) {
    state.next.addEventListener('click', () => {
      const currentIndex = Number(carousel.dataset.currentIndex || 0);
      updateCarousel(carousel, currentIndex + 1);
    });
  }

  updateCarousel(carousel, 0);
}

function setCardSwatchState(card, button) {
  if (!card || !button) {
    return;
  }

  const nextImage = button.dataset.imageUrl;

  card.querySelectorAll('.product-card__swatch').forEach((chip) => {
    const isActive = chip === button;
    chip.classList.toggle('product-card__swatch--active', isActive);
    chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const carousel = card.querySelector('.carousel');

  if (!carousel || !nextImage) {
    return;
  }

  const slideIndex = Array.from(carousel.querySelectorAll('.carousel-slide img'))
    .findIndex((image) => image.getAttribute('src') === nextImage);

  if (slideIndex >= 0) {
    updateCarousel(carousel, slideIndex);
  }
}

function initializeProductCards() {
  shopContainer.querySelectorAll('.product-card').forEach((card) => {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'link');

    card.addEventListener('click', (event) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }

      navigateToProduct(card.dataset.productId);
    });

    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigateToProduct(card.dataset.productId);
      }
    });

    initializeCarousel(card);

    card.querySelectorAll('.product-card__swatch').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        setCardSwatchState(card, button);
      });
    });
  });
}

function renderProducts(products) {
  if (!shopContainer) {
    return;
  }

  shopContainer.classList.add('is-updating');

  if (!Array.isArray(products) || products.length === 0) {
    shopContainer.innerHTML = `
      <div class="shop-grid__empty">
        <div>
          <h3>Ingen produkter at vise lige nu</h3>
          <p>Prøv en anden søgning eller ændr sorteringen.</p>
        </div>
      </div>`;

    window.requestAnimationFrame(() => {
      shopContainer.classList.remove('is-updating');
    });

    return;
  }

  shopContainer.innerHTML = products.map(createProductCard).join('');
  initializeProductCards();

  window.requestAnimationFrame(() => {
    shopContainer.classList.remove('is-updating');
  });
}

async function loadProducts() {
  if (!shopContainer) {
    return;
  }

  shopContainer.innerHTML = `
    <div class="shop-grid__empty">
      <div>
        <h3>Indlæser produkter…</h3>
        <p>Vi henter data fra Supabase og opdaterer siden.</p>
      </div>
    </div>`;

  try {
    const { data: productsData, error: productsError } = await supabase
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
          is_primary,
          color,
          sort_order
        )
      `);

    if (productsError) {
      console.error(productsError);
      renderProducts([]);
      return;
    }

    const products = (productsData ?? []).map(normalizeProduct);
    const filters = createProductFilters({ onChange: renderProducts });

    filters.setProducts(products);
    await filters.loadMetadata();
  } catch (error) {
    console.error(error);
    renderProducts([]);
  }
}

loadProducts();
