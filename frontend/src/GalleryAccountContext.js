import { createContext } from 'react';

export const GalleryAccountContext = createContext({ galleryName: '', accountId: '', onProfileChanged: () => {} });
