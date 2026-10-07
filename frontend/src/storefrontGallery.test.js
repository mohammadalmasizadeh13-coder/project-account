import test from 'node:test';
import assert from 'node:assert/strict';
import { storefrontGallerySlides } from './storefrontGallery.js';

test('gallery excludes hidden images and unavailable products', () => {
  const images = [
    { id: 'visible', url: '/gallery/visible', title: 'گالری' },
    { id: 'hidden', url: '/gallery/hidden', published: false },
    { id: 'missing' },
  ];
  const product = { id: 'ring', title: 'انگشتر', remaining: 1, images: [{ id: 'photo', url: '/product/ring' }] };
  const slides = storefrontGallerySlides(images, [
    product,
    { ...product, id: 'sold', remaining: 0 },
    { ...product, id: 'private', published: false },
    { ...product, id: 'without-photo', images: [] },
  ]);
  assert.deepEqual(slides.map(slide => slide.id), ['gallery-visible', 'product-ring-photo']);
  assert.equal(slides[1].href, '/products/ring');
  assert.equal(slides[0].href, undefined);
});

test('owner photos lead the gallery without duplicate images or repeated product photos', () => {
  const slides = storefrontGallerySlides([{ id: 'cover', url: '/shared', title: 'ویترین' }], [
    { id: 'shared', remaining: 1, images: [{ id: 'same', url: '/shared' }] },
    { id: 'a/b', title: 'گردنبند', remaining: 1, images: [{ id: 'front', url: '/front' }, { id: 'back', url: '/back' }] },
  ]);
  assert.deepEqual(slides.map(slide => slide.url), ['/shared', '/front']);
  assert.equal(slides[1].href, '/products/a%2Fb');
  assert.deepEqual(storefrontGallerySlides(), []);
});
