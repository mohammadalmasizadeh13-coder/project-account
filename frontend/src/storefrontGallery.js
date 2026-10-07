export function storefrontGallerySlides(images = [], products = []) {
  const custom = images.filter(photo => photo.published !== false && photo.url).map(photo => ({
    id: `gallery-${photo.id}`, url: photo.url, title: photo.title || 'گالری نور گلد',
  }));
  const stock = products.filter(product => product.published !== false && product.remaining > 0)
    .flatMap(product => (product.images || []).slice(0, 1).filter(photo => photo.url).map(photo => ({
      id: `product-${product.id}-${photo.id}`, url: photo.url, title: product.title,
      href: `/products/${encodeURIComponent(product.id)}`,
    })));
  const seen = new Set();
  return [...custom, ...stock].filter(photo => {
    if (seen.has(photo.url)) return false;
    seen.add(photo.url);
    return true;
  }).slice(0, 24);
}
